import { detectCharacterKnowledgeIntent } from "../knowledge/CharacterKnowledgeIntent.js"
import { extractGuideImageSources } from "../media/GuideImageInput.js"
import {
  selectGuideImagesForVision,
  selectUsableGuideImages,
} from "../media/ImageDimensions.js"
import {
  sendKnowledgeAnswer,
  sendText,
} from "../ui/reply.js"

function selectGuideReplies(replies) {
  const usable = (replies || []).filter(
    reply => reply?.message !== undefined && reply?.message !== null,
  )
  const withImages = usable.filter(
    reply => extractGuideImageSources(reply.message).length > 0,
  )
  if (withImages.length) return withImages
  return usable.length ? [usable.at(-1)] : []
}

function acceptedAnswer(result, minimumConfidence) {
  return Boolean(
    result?.ok &&
      result.answer?.answerable &&
      result.answer.answer &&
      result.answer.confidence >= minimumConfidence,
  )
}

function knowledgeApi(config) {
  return {
    ...config.api,
    model: config.knowledge.model || config.api.model,
    timeoutMs: config.knowledge.modelTimeoutMs,
    temperature: config.knowledge.temperature,
    maxTokens: config.knowledge.maxTokens,
  }
}

function formatSources(sources, maximum = 3) {
  const lines = []
  for (const source of (sources || []).slice(0, maximum)) {
    const title = String(source.title || "来源").replace(/\s+/g, " ").slice(0, 80)
    const url = String(source.url || "").slice(0, 500)
    if (url) lines.push(`${lines.length + 1}. ${title}\n${url}`)
  }
  return lines
}

function formatKnowledgeReply({ answer, source, sources = [] }) {
  const heading = source === "web" ? "根据联网资料" : "依据当前攻略图"
  const lines = [`${heading}：${answer.answer}`]
  if (answer.evidence.length) {
    lines.push(`依据：${answer.evidence.join("；")}`)
  }
  const sourceLines = source === "web" ? formatSources(sources) : []
  if (sourceLines.length) lines.push(`来源：\n${sourceLines.join("\n")}`)
  return lines.join("\n")
}

function safeErrorCode(error) {
  if (!error) return "unknown"
  if (typeof error.code === "string" && error.code) {
    return error.code.replace(/[^\w.-]/g, "").slice(0, 80)
  }
  if (typeof error.name === "string" && error.name) {
    return error.name.replace(/[^\w.-]/g, "").slice(0, 80)
  }
  return "unknown"
}

export class CharacterKnowledgeService {
  constructor({
    catalog,
    dispatcher,
    guideImageInput,
    answerer,
    webSearch,
    configManager,
    pluginLoader,
    segment,
    logger = console,
  }) {
    this.catalog = catalog
    this.dispatcher = dispatcher
    this.guideImageInput = guideImageInput
    this.answerer = answerer
    this.webSearch = webSearch
    this.configManager = configManager
    this.pluginLoader = pluginLoader
    this.segment = segment
    this.logger = logger
  }

  async handle({ event, text, context, config, apiKey }) {
    if (!config.knowledge.enabled) return { handled: false }

    const intent = detectCharacterKnowledgeIntent({
      text,
      context,
      catalog: this.catalog,
    })
    if (!intent) return { handled: false }

    const knowledgeConfig = config.knowledge
    const guideResult = await this.captureGuide({
      event,
      intent,
      config,
    })
    const selectedReplies = selectGuideReplies(guideResult.replies)
    const images = selectedReplies.length
      ? await this.guideImageInput.prepare(
          selectedReplies.map(reply => reply.message),
          {
            maxImages: knowledgeConfig.maxGuideImages,
            maxBytesPerImage: knowledgeConfig.maxBytesPerImage,
            timeoutMs: knowledgeConfig.imageTimeoutMs,
            allowInsecureHttp: config.vision.allowInsecureHttp,
          },
        )
      : { hadImages: false, images: [], failures: [], sourceCount: 0 }
    const fallbackImages = selectUsableGuideImages(
      images.images,
      knowledgeConfig.maxGuideImages,
    )
    const visionImages = selectGuideImagesForVision(
      images.images,
      knowledgeConfig.maxGuideImages,
    )

    const modelApi = knowledgeApi(config)
    if (
      knowledgeConfig.guideVisionEnabled &&
      config.vision.enabled &&
      visionImages.length
    ) {
      try {
        const answered = await this.answerer.answerFromGuide({
          intent,
          images: visionImages,
          api: modelApi,
          apiKey,
          detail: knowledgeConfig.detail,
        })
        if (acceptedAnswer(answered, knowledgeConfig.minConfidence)) {
          const reply = formatKnowledgeReply({
            answer: answered.answer,
            source: "guide",
          })
          await sendKnowledgeAnswer(event, {
            text: reply,
            command: intent.guide?.command,
            label: `查看${intent.character}完整攻略`,
            segment: this.segment,
            config: config.reply,
          })
          return {
            handled: true,
            decision: "knowledge_guide_answer",
            confidence: answered.answer.confidence,
            model: answered.responseMeta?.model,
            memoryReply: reply,
            intent,
          }
        }
      } catch (error) {
        this.logger.warn?.(
          `[aiEnhance-plugin] 攻略图片问答失败 code=${safeErrorCode(error)}`,
        )
      }
    }

    if (knowledgeConfig.webSearch.enabled) {
      try {
        const searched = await this.webSearch.answer({
          intent,
          config: knowledgeConfig.webSearch,
          mainApi: config.api,
          mainApiKey: apiKey,
          searchApiKey: this.configManager.resolveWebSearchApiKey(config),
        })
        if (acceptedAnswer(searched, knowledgeConfig.minConfidence)) {
          const reply = formatKnowledgeReply({
            answer: searched.answer,
            source: "web",
            sources: searched.sources,
          })
          await sendKnowledgeAnswer(event, {
            text: reply,
            command: intent.guide?.command,
            label: `查看${intent.character}完整攻略`,
            segment: this.segment,
            config: config.reply,
          })
          return {
            handled: true,
            decision: "knowledge_web_answer",
            confidence: searched.answer.confidence,
            model: searched.responseMeta?.model,
            provider: searched.provider,
            memoryReply: reply,
            intent,
          }
        }
      } catch (error) {
        this.logger.warn?.(
          `[aiEnhance-plugin] 联网攻略问答失败 code=${safeErrorCode(error)}`,
        )
      }
    }

    if (selectedReplies.length) {
      const fallbackImage = fallbackImages[0]
      const reply = fallbackImage
        ? "暂时没能可靠提炼攻略图内容，先给你一份适合直接查看的攻略图。"
        : "攻略图过长或暂时无法读取，请点击按钮查看完整攻略。"
      await sendKnowledgeAnswer(event, {
        text: reply,
        command: intent.guide?.command,
        label: `查看${intent.character}完整攻略`,
        image: fallbackImage,
        segment: this.segment,
        config: config.reply,
      })
      return {
        handled: true,
        decision: fallbackImage
          ? "knowledge_guide_fallback"
          : "knowledge_guide_button_fallback",
        memoryReply: reply,
        intent,
      }
    }

    await sendText(event, config.reply.knowledgeUnavailable, config.reply)
    return {
      handled: true,
      decision: "knowledge_unavailable",
      intent,
      reason: guideResult.reason,
    }
  }

  async captureGuide({ event, intent, config }) {
    const guide = intent.guide
    if (!guide) return { replies: [], reason: "guide_candidate_unavailable" }
    if (!config.routing.autoExecuteEnabled) {
      return { replies: [], reason: "auto_execute_disabled" }
    }
    if (!config.commands.autoExecuteAllowlist.includes(guide.candidateId)) {
      return { replies: [], reason: "guide_not_allowlisted" }
    }
    if (guide.candidate.risk !== "read" || !guide.candidate.autoExecute) {
      return { replies: [], reason: "guide_not_safe" }
    }

    const validation = this.catalog.validateRuntime(
      guide.candidate,
      guide.command,
      this.pluginLoader,
      event,
    )
    if (!validation.ok) {
      return { replies: [], reason: validation.reason }
    }

    const captured = await this.dispatcher.capture(
      event,
      {
        command: guide.command,
        candidateId: guide.candidateId,
      },
      { timeoutMs: config.knowledge.guideTimeoutMs },
    )
    return {
      replies: captured.replies || [],
      reason: captured.ok ? "" : captured.error,
    }
  }
}

export {
  acceptedAnswer,
  formatKnowledgeReply,
  formatSources,
  knowledgeApi,
  safeErrorCode,
  selectGuideReplies,
}
