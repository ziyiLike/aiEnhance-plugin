import {
  OpenAIHttpError,
  OpenAITimeoutError,
  buildEndpoint,
} from "../api/OpenAICompatibleClient.js"
import {
  KNOWLEDGE_ANSWER_SCHEMA,
  parseKnowledgeAnswer,
} from "../knowledge/answerSchema.js"
import {
  WEB_SYSTEM_PROMPT,
  questionPayload,
} from "../knowledge/KnowledgeAnswerer.js"

function allowedUrl(value, allowedDomains = []) {
  let url
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (!["http:", "https:"].includes(url.protocol)) return null
  if (!allowedDomains.length) return url

  const hostname = url.hostname.toLowerCase()
  const allowed = allowedDomains.some(domain => {
    const normalized = String(domain || "")
      .trim()
      .toLowerCase()
      .replace(/^\./, "")
    return normalized && (hostname === normalized || hostname.endsWith(`.${normalized}`))
  })
  return allowed ? url : null
}

function uniqueSources(sources, allowedDomains = [], maxResults = 5) {
  const result = []
  const seen = new Set()
  for (const source of sources || []) {
    const url = allowedUrl(source?.url, allowedDomains)
    if (!url || seen.has(url.href)) continue
    seen.add(url.href)
    result.push({
      title: String(source?.title || url.hostname).replace(/\s+/g, " ").slice(0, 200),
      url: url.href,
      snippet: String(source?.snippet || "")
        .replace(/\s+/g, " ")
        .slice(0, 1_000),
    })
    if (result.length >= maxResults) break
  }
  return result
}

async function fetchJsonWithTimeout(
  fetchImpl,
  url,
  { method = "GET", headers, body, timeoutMs },
) {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    const response = await fetchImpl(url, {
      method,
      headers,
      body,
      signal: controller.signal,
    })
    const text = await response.text()
    let payload
    try {
      payload = text ? JSON.parse(text) : {}
    } catch {
      payload = null
    }
    if (!response.ok) {
      throw new OpenAIHttpError(
        payload?.error?.message ||
          payload?.message ||
          `模型联网返回 HTTP ${response.status}`,
        {
          status: response.status,
          code: payload?.error?.code || "",
          retryable: response.status === 429 || response.status >= 500,
        },
      )
    }
    if (!payload) throw new OpenAIHttpError("模型联网响应不是 JSON")
    return payload
  } catch (error) {
    if (timedOut) throw new OpenAITimeoutError("模型联网请求超时")
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function extractResponsesText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim()
  }
  const parts = []
  for (const item of payload?.output || []) {
    if (item?.type !== "message") continue
    for (const content of item.content || []) {
      if (
        ["output_text", "text"].includes(content?.type) &&
        typeof content.text === "string"
      ) {
        parts.push(content.text)
      }
    }
  }
  return parts.join("").trim()
}

function extractResponsesSources(payload) {
  const sources = []
  for (const item of payload?.output || []) {
    if (item?.type === "message") {
      for (const content of item.content || []) {
        for (const annotation of content?.annotations || []) {
          if (annotation?.url) {
            sources.push({
              title: annotation.title,
              url: annotation.url,
              snippet: "",
            })
          }
        }
      }
    }
    if (item?.type === "web_search_call") {
      for (const source of item.action?.sources || []) {
        sources.push({
          title: source.title,
          url: source.url,
          snippet: source.snippet,
        })
      }
    }
  }
  return sources
}

function responsesRequestBody(intent, config, mainApi) {
  const allowedDomains = config.allowedDomains || []
  const webTool = { type: "web_search" }
  if (allowedDomains.length) {
    webTool.filters = { allowed_domains: allowedDomains }
  }

  return {
    model: config.model || mainApi.model,
    tools: [webTool],
    // 攻略图已经无法回答；这里必须真正联网，不能让模型退回自身记忆。
    tool_choice: "required",
    include: ["web_search_call.action.sources"],
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: WEB_SYSTEM_PROMPT }],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `请联网检索并回答：\n${JSON.stringify(questionPayload(intent))}`,
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "ai_enhance_web_answer",
        strict: true,
        schema: KNOWLEDGE_ANSWER_SCHEMA,
      },
    },
  }
}

export class WebSearchService {
  constructor({ fetchImpl = globalThis.fetch, logger = console } = {}) {
    if (typeof fetchImpl !== "function") {
      throw new TypeError("当前 Node.js 环境没有可用的 fetch")
    }
    this.fetch = fetchImpl
    this.logger = logger
  }

  async answer({
    intent,
    config,
    mainApi,
    mainApiKey,
    searchApiKey,
  }) {
    if (!config.enabled) return { ok: false, error: "模型联网未开启" }

    const baseUrl = config.baseUrl || mainApi.baseUrl
    const endpoint = config.endpoint || "/responses"
    const headers = {
      "content-type": "application/json",
      ...mainApi.extraHeaders,
      ...config.extraHeaders,
    }
    const apiKey = searchApiKey || mainApiKey
    if (apiKey) headers.authorization = `Bearer ${apiKey}`

    const payload = await fetchJsonWithTimeout(
      this.fetch,
      buildEndpoint(baseUrl, endpoint),
      {
        method: "POST",
        headers,
        body: JSON.stringify(responsesRequestBody(intent, config, mainApi)),
        timeoutMs: config.timeoutMs,
      },
    )
    const didSearch = (payload.output || []).some(
      item => item?.type === "web_search_call",
    )
    if (!didSearch) return { ok: false, error: "模型没有执行 web_search" }

    const parsed = parseKnowledgeAnswer(extractResponsesText(payload))
    if (!parsed.ok) {
      this.logger.warn?.(
        `[aiEnhance-plugin] 无法解析模型联网结果：${parsed.error}`,
      )
      return { ok: false, error: parsed.error }
    }

    return {
      ok: true,
      answer: parsed.data,
      provider: "model_web_search",
      sources: uniqueSources(
        extractResponsesSources(payload),
        config.allowedDomains,
        config.maxResults,
      ),
      responseMeta: {
        model: payload.model || config.model || mainApi.model,
        usage: payload.usage || null,
      },
    }
  }
}

export {
  allowedUrl,
  extractResponsesSources,
  extractResponsesText,
  fetchJsonWithTimeout,
  responsesRequestBody,
  uniqueSources,
}
