import { ROUTE_JSON_SCHEMA } from "./routeSchema.js"

export class OpenAIHttpError extends Error {
  constructor(message, { status = 0, code = "", retryable = false } = {}) {
    super(message)
    this.name = "OpenAIHttpError"
    this.status = status
    this.code = code
    this.retryable = retryable
  }
}

export class OpenAITimeoutError extends Error {
  constructor(message = "OpenAI-compatible API request timed out") {
    super(message)
    this.name = "OpenAITimeoutError"
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function buildEndpoint(baseUrl, endpoint) {
  const endpointText = String(endpoint || "").trim()
  if (/^https?:\/\//i.test(endpointText)) return endpointText

  const base = String(baseUrl || "").replace(/\/+$/, "")
  const suffix = endpointText ? `/${endpointText.replace(/^\/+/, "")}` : ""
  return `${base}${suffix}`
}

function normalizeContent(content) {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""

  return content
    .map(part => {
      if (typeof part === "string") return part
      if (part?.type === "text" && typeof part.text === "string") return part.text
      return ""
    })
    .join("")
}

function extractErrorMessage(payload, fallback) {
  const message = payload?.error?.message || payload?.message
  if (typeof message !== "string") return fallback
  return message.replace(/\s+/g, " ").slice(0, 500)
}

function responseFormatFor(mode) {
  if (mode === "json_schema") {
    return {
      type: "json_schema",
      json_schema: {
        name: "ai_enhance_route",
        strict: true,
        schema: ROUTE_JSON_SCHEMA,
      },
    }
  }
  if (mode === "json_object") return { type: "json_object" }
  return undefined
}

function formatModes(configuredMode) {
  switch (configuredMode) {
    case "json_schema":
    case "json_object":
    case "none":
      return [configuredMode]
    default:
      return ["json_schema", "json_object", "none"]
  }
}

export class OpenAICompatibleClient {
  constructor({ fetchImpl = globalThis.fetch, logger = console } = {}) {
    if (typeof fetchImpl !== "function") {
      throw new TypeError("当前 Node.js 环境没有可用的 fetch")
    }
    this.fetch = fetchImpl
    this.logger = logger
  }

  async complete({ api, apiKey = "", messages, signal }) {
    const modes = formatModes(api.responseFormat)
    let lastError

    for (let index = 0; index < modes.length; index++) {
      const mode = modes[index]
      try {
        return await this.requestWithRetries({
          api,
          apiKey,
          messages,
          responseFormatMode: mode,
          signal,
        })
      } catch (error) {
        lastError = error
        const mayBeUnsupportedFormat =
          error instanceof OpenAIHttpError &&
          [400, 422].includes(error.status) &&
          index < modes.length - 1

        if (!mayBeUnsupportedFormat) throw error
        this.logger.warn?.(
          `[aiEnhance-plugin] API 不接受 ${mode}，尝试兼容模式 ${modes[index + 1]}`,
        )
      }
    }

    throw lastError
  }

  async requestWithRetries(params) {
    const retries = Math.max(0, Number(params.api.retries) || 0)
    let lastError

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await this.requestOnce(params)
      } catch (error) {
        lastError = error
        if (!error?.retryable || attempt >= retries) throw error
        await sleep(250 * 2 ** attempt)
      }
    }

    throw lastError
  }

  async requestOnce({ api, apiKey, messages, responseFormatMode, signal }) {
    const controller = new AbortController()
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, api.timeoutMs)

    const abort = () => controller.abort()
    if (signal?.aborted) controller.abort()
    else signal?.addEventListener?.("abort", abort, { once: true })

    const headers = {
      "content-type": "application/json",
      ...api.extraHeaders,
    }
    if (apiKey) headers.authorization = `Bearer ${apiKey}`

    const body = {
      model: api.model,
      messages,
      stream: false,
    }
    if (api.temperature !== null && api.temperature !== undefined) {
      body.temperature = api.temperature
    }
    if (api.maxTokensField && api.maxTokensField !== "none") {
      body[api.maxTokensField] = api.maxTokens
    }
    const responseFormat = responseFormatFor(responseFormatMode)
    if (responseFormat) body.response_format = responseFormat

    try {
      const response = await this.fetch(buildEndpoint(api.baseUrl, api.endpoint), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      const rawText = await response.text()
      let payload
      try {
        payload = rawText ? JSON.parse(rawText) : {}
      } catch {
        payload = null
      }

      if (!response.ok) {
        throw new OpenAIHttpError(
          extractErrorMessage(payload, `API 返回 HTTP ${response.status}`),
          {
            status: response.status,
            code: payload?.error?.code || "",
            retryable: response.status === 429 || response.status >= 500,
          },
        )
      }

      if (!payload || !Array.isArray(payload.choices) || !payload.choices[0]?.message) {
        throw new OpenAIHttpError("API 响应缺少 choices[0].message")
      }

      const content = normalizeContent(payload.choices[0].message.content)
      if (!content) throw new OpenAIHttpError("API 响应内容为空")

      return {
        content,
        model: payload.model || api.model,
        usage: payload.usage || null,
        finishReason: payload.choices[0].finish_reason || null,
        responseFormatMode,
      }
    } catch (error) {
      if (timedOut) throw new OpenAITimeoutError()
      if (error?.name === "AbortError") throw error
      if (error instanceof OpenAIHttpError) throw error
      throw new OpenAIHttpError(error?.message || "API 网络请求失败", {
        retryable: true,
      })
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener?.("abort", abort)
    }
  }
}

export { buildEndpoint, normalizeContent, responseFormatFor }
