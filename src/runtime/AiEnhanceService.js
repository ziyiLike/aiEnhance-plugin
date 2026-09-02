import crypto from "node:crypto"
import { isReplayedEvent } from "./SafeDispatcher.js"
import {
  canResolveQuotedMessage,
  resolveQuotedMessage,
  withQuotedImages,
} from "./QuotedMessage.js"
import { extractImageSources } from "../media/ImageInput.js"
import { sendConfirmation, sendClarification, sendText } from "../ui/reply.js"
import {
  commandSuggestions,
  contextualCharacterSuggestions,
  decisionClarification,
  hasCharacterCommandIntent,
  modelClarification,
} from "../ui/suggestions.js"

function eventIdentity(event) {
  const scope = event.group_id ? `group:${event.group_id}` : "private"
  return `${event.self_id || "bot"}:${scope}:${event.user_id || "unknown"}`
}

function identityHash(event) {
  return crypto.createHash("sha256").update(eventIdentity(event)).digest("hex").slice(0, 12)
}

function groupIsEnabled(event, triggerConfig) {
  const identifiers = new Set(
    [event.group_id, event.group?.group_id]
      .filter(value => value !== undefined && value !== null && value !== "")
      .map(String),
  )
  if (triggerConfig.disabledGroups.some(groupId => identifiers.has(groupId))) {
    return false
  }
  return (
    triggerConfig.enabledGroups.length === 0 ||
    triggerConfig.enabledGroups.some(groupId => identifiers.has(groupId))
  )
}

function shouldHandleEvent(event, config) {
  if (!event || isReplayedEvent(event)) return false
  if (!event.user_id || String(event.user_id) === String(event.self_id)) return false

  if (event.isPrivate || event.message_type === "private") {
    return config.trigger.privateEnabled
  }

  if (!(event.isGroup || event.group_id)) return false
  if (!groupIsEnabled(event, config.trigger)) return false
  if (!config.trigger.requireAtInGroup) return true
  if (event.atBot) return true
  return config.trigger.allowAliasInGroup && event.hasAlias
}

function extractText(event) {
  if (Array.isArray(event?.message)) {
    const text = event.message
      .filter(segment => segment?.type === "text" && typeof segment.text === "string")
      .map(segment => segment.text)
      .join("")
      .trim()
    if (text || event.message.some(segment => segment?.type === "image")) return text
  }

  const text = event.msg ?? event.raw_message ?? ""
  return String(text).trim()
}

function errorSummary(error) {
  if (!error) return "UnknownError"
  if (["OpenAIHttpError", "OpenAITimeoutError"].includes(error.name)) {
    const status = Number(error.status) || 0
    const code = String(error.code || "").replace(/[^\w.-]/g, "").slice(0, 80)
    return `${error.name} status=${status}${code ? ` code=${code}` : ""}`
  }
  return error.stack || error.message || String(error)
}

function isVisionCompatibilityError(error) {
  return (
    error?.name === "OpenAIHttpError" &&
    [400, 413, 415, 422].includes(Number(error.status))
  )
}

function memoryAssistantContent(reply, summary) {
  const visibleReply = String(reply || "").trim()
  const contextSummary = String(summary || "").trim()
  if (!contextSummary) return visibleReply
  return `[上下文摘要] ${contextSummary}\n[当时回复] ${visibleReply}`
}

export class AiEnhanceService {
  constructor({
    configManager,
    catalog,
    router,
    policy,
    secretDetector,
    memory,
    gate,
    dispatcher,
    imageInput,
    knowledgeService,
    pluginLoader,
    segment,
    logger = console,
  }) {
    this.configManager = configManager
    this.catalog = catalog
    this.router = router
    this.policy = policy
    this.secretDetector = secretDetector
    this.memory = memory
    this.gate = gate
    this.dispatcher = dispatcher
    this.imageInput = imageInput
    this.knowledgeService = knowledgeService
    this.pluginLoader = pluginLoader
    this.segment = segment
    this.logger = logger
  }

  async handle(event) {
    let config
    try {
      config = await this.configManager.load()
    } catch (error) {
      this.logger.error?.(`配置读取失败：${error.stack || error.message}`)
      return false
    }

    if (!config.enabled || !shouldHandleEvent(event, config)) return false

    const text = extractText(event)
    let hasImages = extractImageSources(event).length > 0
    if (!text && !hasImages && !canResolveQuotedMessage(event)) {
      await sendText(event, config.reply.emptyPrompt, config.reply)
      return true
    }

    if (text.length > config.routing.maxInputChars) {
      await sendText(event, config.reply.tooLong, config.reply)
      return true
    }

    const secret = this.secretDetector.inspect(text)
    if (secret.sensitive) {
      this.audit(event, {
        decision: "blocked_sensitive",
        secretTypes: secret.matches,
      }, config)
      await sendText(event, config.reply.sensitive, config.reply)
      return true
    }

    const configErrors = this.configManager.validate(config)
    if (configErrors.length) {
      this.audit(event, {
        decision: "not_configured",
        configErrors,
      }, config)
      await sendText(event, config.reply.notConfigured, config.reply)
      return true
    }

    const gateResult = this.gate.acquire(eventIdentity(event), config.limits)
    if (!gateResult.ok) {
      this.audit(event, {
        decision: "rate_limited",
        reason: gateResult.reason,
      }, config)
      await sendText(event, config.reply.busy, config.reply)
      return true
    }

    try {
      const quotedMessage = await resolveQuotedMessage(event, {
        logger: this.logger,
      })
      const quotedText = quotedMessage ? extractText(quotedMessage) : ""
      const inputEvent = withQuotedImages(event, quotedMessage)
      hasImages = extractImageSources(inputEvent).length > 0

      if (!text && !quotedText && !hasImages) {
        await sendText(event, config.reply.emptyPrompt, config.reply)
        return true
      }

      if (text.length + quotedText.length > config.routing.maxInputChars) {
        await sendText(event, config.reply.tooLong, config.reply)
        return true
      }

      const quotedSecret = this.secretDetector.inspect(quotedText)
      if (quotedSecret.sensitive) {
        this.audit(event, {
          decision: "blocked_sensitive",
          secretTypes: quotedSecret.matches,
          source: "quoted_message",
        }, config)
        await sendText(event, config.reply.sensitive, config.reply)
        return true
      }

      const imageResult = hasImages
        ? await this.imageInput.prepare(inputEvent, config.vision)
        : { hadImages: false, images: [], failures: [] }

      if (imageResult.hadImages && !config.vision.enabled) {
        this.audit(event, { decision: "vision_disabled" }, config)
        await sendText(event, config.reply.visionDisabled, config.reply)
        return true
      }

      if (imageResult.hadImages && imageResult.images.length === 0) {
        this.audit(event, {
          decision: "image_unavailable",
          reasons: [...new Set(imageResult.failures.map(item => item.code))],
        }, config)
        await sendText(event, config.reply.imageError, config.reply)
        return true
      }

      await this.catalog.prepare()
      this.catalog.configure(config.commands)
      const routingQuery = [text, quotedText].filter(Boolean).join("\n")
      const promptText =
        text ||
        (quotedText
          ? "请结合用户引用的消息进行回复。"
          : "请描述用户发送的图片内容。")
      const memoryUserText = [
        text || (quotedText ? "[仅引用消息]" : "[仅发送图片]"),
        quotedText ? `[引用消息] ${quotedText}` : "",
        imageResult.images.length
          ? `[附带 ${imageResult.images.length} 张图片]`
          : "",
      ]
        .filter(Boolean)
        .join(" ")
      const queryContext = this.catalog.analyze(routingQuery)
      const apiKey = this.configManager.resolveApiKey(config)

      if (!imageResult.hadImages && this.knowledgeService) {
        const knowledge = await this.knowledgeService.handle({
          event,
          text,
          context: queryContext,
          config,
          apiKey,
        })
        if (knowledge.handled) {
          const memoryReply =
            knowledge.memoryReply ||
            (knowledge.decision === "knowledge_unavailable"
              ? config.reply.knowledgeUnavailable
              : "已发送当前角色攻略图。")
          await this.memory.append(event, text, memoryReply, config.memory)
          this.audit(
            event,
            {
              decision: knowledge.decision,
              candidateId: knowledge.intent?.guide?.candidateId,
              confidence: knowledge.confidence,
              model: knowledge.model,
              provider: knowledge.provider,
              reason: knowledge.reason,
            },
            config,
          )
          return true
        }
      }

      const rankedCandidates = routingQuery
        ? this.catalog.rank(routingQuery, { context: queryContext })
        : []
      const searchResults = rankedCandidates
        .filter(result => result.score >= 0.04)
        .slice(0, config.routing.topK)
      const history = await this.memory.get(event, config.memory)
      const routing = await this.router.route({
        text: promptText,
        quotedText,
        images: imageResult.images,
        candidates: rankedCandidates,
        likelyCandidates: searchResults,
        history,
        api: config.api,
        apiKey,
        context: queryContext,
        vision: config.vision,
      })

      if (!routing.ok) {
        this.audit(event, {
          decision: "invalid_model_output",
          reason: routing.error,
        }, config)
        await sendText(event, config.reply.apiError, config.reply)
        return true
      }

      const route = routing.route
      if (route.mode === "chat") {
        const suggestions = hasCharacterCommandIntent(text)
          ? contextualCharacterSuggestions(queryContext, text, this.catalog)
          : []
        if (suggestions.length) {
          await sendClarification(event, {
            message: route.reply,
            suggestions,
            segment: this.segment,
            config: config.reply,
          })
        } else {
          await sendText(event, route.reply, config.reply)
        }
        await this.memory.append(
          event,
          memoryUserText,
          memoryAssistantContent(route.reply, route.memorySummary),
          config.memory,
        )
        this.audit(event, {
          decision: "chat",
          confidence: route.confidence,
          model: routing.responseMeta.model,
        }, config)
        return true
      }

      if (route.mode === "clarify") {
        const suggestions = commandSuggestions({
          route,
          context: queryContext,
          text,
          searchResults,
          catalog: this.catalog,
        })
        await sendClarification(event, {
          message: route.reply,
          suggestions,
          segment: this.segment,
          config: config.reply,
        })
        await this.memory.append(
          event,
          memoryUserText,
          memoryAssistantContent(route.reply, route.memorySummary),
          config.memory,
        )
        this.audit(event, {
          decision: "clarify",
          confidence: route.confidence,
        }, config)
        return true
      }

      const offeredIds = new Set(
        rankedCandidates.map(result => result.candidate.id),
      )
      if (!offeredIds.has(route.candidateId)) {
        const message = "我没能把你的意思安全地对应到现有功能，请换一种更具体的说法。"
        await sendClarification(event, {
          message,
          suggestions: commandSuggestions({
            route,
            context: queryContext,
            text,
            searchResults,
            catalog: this.catalog,
          }),
          segment: this.segment,
          config: config.reply,
        })
        this.audit(event, {
          decision: "rejected_unoffered_candidate",
          candidateId: route.candidateId,
        }, config)
        return true
      }

      const built = this.catalog.buildCommand(route.candidateId, route.slots, {
        context: queryContext,
      })
      if (!built.ok) {
        const message = modelClarification(route, built.error)
        await sendClarification(event, {
          message,
          suggestions: commandSuggestions({
            route,
            context: queryContext,
            text,
            searchResults,
            catalog: this.catalog,
          }),
          segment: this.segment,
          config: config.reply,
        })
        await this.memory.append(
          event,
          memoryUserText,
          memoryAssistantContent(message, route.memorySummary),
          config.memory,
        )
        this.audit(event, {
          decision: "invalid_command_arguments",
          candidateId: route.candidateId,
          reason: built.error,
        }, config)
        return true
      }

      const decision = this.policy.decide({
        route,
        candidate: built.candidate,
        searchResults: rankedCandidates,
        config,
        queryContext,
      })

      if (decision.action === "clarify") {
        const message =
          decision.reason === "candidate_ranked_below_alternative"
            ? decisionClarification(decision, built.candidate)
            : route.reply || decisionClarification(decision, built.candidate)
        const builtSuggestion = {
          description: built.candidate.description,
          command: built.command,
        }
        const omitPrimary = [
          "query_game_conflict",
          "query_character_ambiguous",
        ].includes(decision.reason)
        await sendClarification(event, {
          message,
          suggestions: commandSuggestions({
            route,
            context: queryContext,
            text,
            searchResults,
            catalog: this.catalog,
            primary: omitPrimary ? [] : [builtSuggestion],
          }),
          segment: this.segment,
          config: config.reply,
        })
        await this.memory.append(
          event,
          memoryUserText,
          memoryAssistantContent(message, route.memorySummary),
          config.memory,
        )
        this.audit(event, {
          decision: "clarify_command",
          candidateId: built.candidate.id,
          confidence: route.confidence,
          ...decision,
        }, config)
        return true
      }

      const runtimeValidation = this.catalog.validateRuntime(
        built.candidate,
        built.command,
        this.pluginLoader,
        event,
      )
      if (!runtimeValidation.ok) {
        await sendText(
          event,
          `暂时无法执行这个功能：${runtimeValidation.reason}。`,
          config.reply,
        )
        this.audit(event, {
          decision: "runtime_validation_failed",
          candidateId: built.candidate.id,
          reason: runtimeValidation.reason,
        }, config)
        return true
      }

      if (decision.action === "confirm") {
        const suggestions = commandSuggestions({
          route,
          context: queryContext,
          text,
          searchResults,
          catalog: this.catalog,
          primary: [
            {
              description: built.candidate.description,
              command: built.command,
            },
          ],
          includeLocalFallbacks: false,
        })
        if (suggestions.length > 1) {
          await sendClarification(event, {
            message: "可以，直接用下面这些命令：",
            suggestions,
            segment: this.segment,
            config: config.reply,
          })
        } else {
          await sendConfirmation(event, {
            candidate: built.candidate,
            command: built.command,
            decision,
            segment: this.segment,
            config: config.reply,
          })
        }
        this.audit(event, {
          decision: "confirm",
          candidateId: built.candidate.id,
          reason: decision.reason,
          confidence: route.confidence,
          retrievalScore: decision.selectedScore,
          retrievalMargin: decision.margin,
          suggestionCount: suggestions.length,
        }, config)
        return true
      }

      const dispatched = await this.dispatcher.dispatch(event, {
        command: built.command,
        candidateId: built.candidate.id,
      })
      if (!dispatched.ok) {
        await sendText(event, config.reply.apiError, config.reply)
        this.audit(event, {
          decision: "dispatch_failed",
          candidateId: built.candidate.id,
          reason: dispatched.error,
        }, config)
        return true
      }

      this.audit(event, {
        decision: "executed",
        candidateId: built.candidate.id,
        confidence: route.confidence,
        retrievalScore: decision.selectedScore,
        retrievalMargin: decision.margin,
      }, config)
      return true
    } catch (error) {
      // 第三方 API 的错误文本可能回显请求内容，日志只保留状态与错误码。
      this.logger.error?.(`请求处理失败：${errorSummary(error)}`)
      await sendText(
        event,
        hasImages && isVisionCompatibilityError(error)
          ? config.reply.visionUnsupported
          : config.reply.apiError,
        config.reply,
      )
      return true
    } finally {
      gateResult.release()
    }
  }

  async clearMemory(event) {
    await this.memory.clear(event)
  }

  audit(event, data, config) {
    if (!config.logging.decisions) return
    this.logger.info?.(
      `decision=${data.decision} actor=${identityHash(event)} ${Object.entries(data)
        .filter(
          ([key, value]) => key !== "decision" && value !== undefined,
        )
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join(" ")}`.trim(),
    )
  }
}

export { fixedSuggestions, mergeSuggestions } from "../ui/suggestions.js"

export {
  eventIdentity,
  identityHash,
  groupIsEnabled,
  shouldHandleEvent,
  extractText,
  contextualCharacterSuggestions,
  hasCharacterCommandIntent,
  modelClarification,
  decisionClarification,
  errorSummary,
  isVisionCompatibilityError,
  memoryAssistantContent,
}
