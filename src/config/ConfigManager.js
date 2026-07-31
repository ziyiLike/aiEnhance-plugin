import fs from "node:fs/promises"
import path from "node:path"
import YAML from "yaml"
import {
  GUIDE_AUTO_EXECUTE_IDS,
  LEGACY_DEFAULT_AUTO_EXECUTE_ALLOWLIST,
  cloneDefaults,
} from "./defaults.js"

const RESPONSE_FORMATS = new Set(["auto", "json_schema", "json_object", "none"])
const MAX_TOKEN_FIELDS = new Set(["max_tokens", "max_completion_tokens", "none"])
const VISION_DETAIL_LEVELS = new Set(["auto", "low", "high", "original"])

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

/**
 * 仅合并默认配置中已知的对象层级；custom/extraHeaders 这类扩展字段保留用户键。
 * 这样既允许扩展，又不会把 __proto__ 一类字段带进运行时对象。
 */
function mergeConfig(base, input, pathParts = []) {
  if (!isPlainObject(input)) return base

  for (const [key, value] of Object.entries(input)) {
    if (key === "__proto__" || key === "prototype" || key === "constructor") continue

    const containerPath = pathParts.join(".")
    const allowsDynamicKeys = [
      "api.extraHeaders",
      "knowledge.webSearch.extraHeaders",
    ].includes(containerPath)

    if (!(key in base) && !allowsDynamicKeys) continue

    if (Array.isArray(value)) {
      base[key] = structuredClone(value)
    } else if (isPlainObject(value)) {
      if (!isPlainObject(base[key])) base[key] = {}
      base[key] = mergeConfig(base[key], value, [...pathParts, key])
    } else {
      base[key] = value
    }
  }

  return base
}

function isLoopback(hostname) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost")
  )
}

function finiteNumber(value, fallback, minimum, maximum) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(maximum, Math.max(minimum, number))
}

function sameStringSet(left, right) {
  if (!Array.isArray(left) || left.length !== right.length) return false
  const values = new Set(left.map(String))
  return values.size === right.length && right.every(item => values.has(item))
}

function migrateLegacyAutoExecuteAllowlist(config) {
  if (config.commands.migrateLegacyAllowlist === false) return false
  const allowlist = config.commands.autoExecuteAllowlist
  if (!sameStringSet(allowlist, LEGACY_DEFAULT_AUTO_EXECUTE_ALLOWLIST)) return false

  allowlist.push(...GUIDE_AUTO_EXECUTE_IDS)
  return true
}

function normalizeConfig(config) {
  config.api.timeoutMs = finiteNumber(config.api.timeoutMs, 20_000, 1_000, 120_000)
  config.api.retries = Math.round(finiteNumber(config.api.retries, 1, 0, 3))
  config.api.temperature =
    config.api.temperature === null
      ? null
      : finiteNumber(config.api.temperature, 0.2, 0, 2)
  config.api.maxTokens = Math.round(finiteNumber(config.api.maxTokens, 900, 64, 16_384))
  config.api.maxTokensField = MAX_TOKEN_FIELDS.has(config.api.maxTokensField)
    ? config.api.maxTokensField
    : "max_tokens"
  config.api.responseFormat = RESPONSE_FORMATS.has(config.api.responseFormat)
    ? config.api.responseFormat
    : "auto"

  config.vision.maxImages = Math.round(
    finiteNumber(config.vision.maxImages, 3, 1, 10),
  )
  config.vision.maxBytesPerImage = Math.round(
    finiteNumber(config.vision.maxBytesPerImage, 5_242_880, 65_536, 20_971_520),
  )
  config.vision.timeoutMs = Math.round(
    finiteNumber(config.vision.timeoutMs, 10_000, 1_000, 60_000),
  )
  config.vision.detail = VISION_DETAIL_LEVELS.has(config.vision.detail)
    ? config.vision.detail
    : "auto"

  config.knowledge.minConfidence = finiteNumber(
    config.knowledge.minConfidence,
    0.78,
    0,
    1,
  )
  config.knowledge.maxGuideImages = Math.round(
    finiteNumber(config.knowledge.maxGuideImages, 2, 1, 6),
  )
  config.knowledge.maxBytesPerImage = Math.round(
    finiteNumber(
      config.knowledge.maxBytesPerImage,
      10_485_760,
      65_536,
      20_971_520,
    ),
  )
  config.knowledge.imageTimeoutMs = Math.round(
    finiteNumber(config.knowledge.imageTimeoutMs, 15_000, 1_000, 120_000),
  )
  config.knowledge.guideTimeoutMs = Math.round(
    finiteNumber(config.knowledge.guideTimeoutMs, 45_000, 1_000, 180_000),
  )
  config.knowledge.modelTimeoutMs = Math.round(
    finiteNumber(config.knowledge.modelTimeoutMs, 60_000, 1_000, 180_000),
  )
  config.knowledge.detail = VISION_DETAIL_LEVELS.has(config.knowledge.detail)
    ? config.knowledge.detail
    : "high"
  config.knowledge.temperature =
    config.knowledge.temperature === null
      ? null
      : finiteNumber(config.knowledge.temperature, 0.1, 0, 2)
  config.knowledge.maxTokens = Math.round(
    finiteNumber(config.knowledge.maxTokens, 900, 64, 16_384),
  )

  const webSearch = config.knowledge.webSearch
  webSearch.timeoutMs = Math.round(
    finiteNumber(webSearch.timeoutMs, 25_000, 1_000, 120_000),
  )
  webSearch.maxResults = Math.round(
    finiteNumber(webSearch.maxResults, 5, 1, 10),
  )
  webSearch.allowedDomains = Array.isArray(webSearch.allowedDomains)
    ? webSearch.allowedDomains
        .map(String)
        .map(item => item.trim().toLowerCase().replace(/^\./, ""))
        .filter(Boolean)
        .slice(0, 20)
    : []
  if (!isPlainObject(webSearch.extraHeaders)) webSearch.extraHeaders = {}

  config.routing.topK = Math.round(finiteNumber(config.routing.topK, 12, 1, 30))
  config.routing.maxInputChars = Math.round(
    finiteNumber(config.routing.maxInputChars, 2_000, 50, 20_000),
  )
  config.routing.autoExecuteConfidence = finiteNumber(
    config.routing.autoExecuteConfidence,
    0.92,
    0,
    1,
  )
  config.routing.confirmConfidence = finiteNumber(
    config.routing.confirmConfidence,
    0.65,
    0,
    1,
  )
  config.routing.minAutoRetrievalScore = finiteNumber(
    config.routing.minAutoRetrievalScore,
    0.18,
    0,
    1,
  )
  config.routing.minAutoRetrievalMargin = finiteNumber(
    config.routing.minAutoRetrievalMargin,
    0.06,
    0,
    1,
  )

  config.memory.ttlSeconds = Math.round(
    finiteNumber(config.memory.ttlSeconds, 900, 60, 86_400),
  )
  config.memory.maxMessages = Math.round(
    finiteNumber(config.memory.maxMessages, 8, 0, 30),
  )
  config.memory.maxMessageChars = Math.round(
    finiteNumber(config.memory.maxMessageChars, 1_000, 50, 5_000),
  )

  config.limits.perUserRequests = Math.round(
    finiteNumber(config.limits.perUserRequests, 6, 1, 100),
  )
  config.limits.perUserWindowSeconds = Math.round(
    finiteNumber(config.limits.perUserWindowSeconds, 60, 1, 3_600),
  )
  config.limits.globalConcurrency = Math.round(
    finiteNumber(config.limits.globalConcurrency, 3, 1, 50),
  )

  for (const key of [
    "enabledGroups",
    "disabledGroups",
  ]) {
    config.trigger[key] = Array.isArray(config.trigger[key])
      ? config.trigger[key].map(String)
      : []
  }

  for (const key of [
    "enabledPresets",
    "disabledIds",
    "autoExecuteAllowlist",
  ]) {
    config.commands[key] = Array.isArray(config.commands[key])
      ? config.commands[key].map(String)
      : []
  }

  if (!Array.isArray(config.commands.custom)) config.commands.custom = []
  if (!isPlainObject(config.api.extraHeaders)) config.api.extraHeaders = {}

  return config
}

export class ConfigManager {
  constructor({
    cwd = process.cwd(),
    pluginRoot,
    configPath = path.join(cwd, "config", "aiEnhance.yaml"),
    env = process.env,
    logger = console,
  }) {
    this.cwd = cwd
    this.pluginRoot = pluginRoot
    this.configPath = configPath
    this.defaultPath = path.join(pluginRoot, "config", "default.yaml")
    this.env = env
    this.logger = logger
    this.cache = null
    this.mtimeMs = -1
  }

  async ensureConfigFile() {
    try {
      await fs.access(this.configPath)
      return
    } catch {}

    await fs.mkdir(path.dirname(this.configPath), { recursive: true })
    try {
      await fs.copyFile(this.defaultPath, this.configPath)
    } catch {
      await fs.writeFile(this.configPath, YAML.stringify(cloneDefaults()), "utf8")
    }
    await fs.chmod(this.configPath, 0o600).catch(() => {})
    this.logger.info?.(`[aiEnhance-plugin] 已创建配置文件 ${this.configPath}`)
  }

  async load({ force = false } = {}) {
    await this.ensureConfigFile()
    const stat = await fs.stat(this.configPath)
    if (!force && this.cache && stat.mtimeMs === this.mtimeMs) return this.cache

    const source = await fs.readFile(this.configPath, "utf8")
    const parsed = YAML.parse(source) ?? {}
    this.cache = normalizeConfig(mergeConfig(cloneDefaults(), parsed))
    if (migrateLegacyAutoExecuteAllowlist(this.cache)) {
      this.logger.info?.(
        "[aiEnhance-plugin] 已为旧版默认自动执行白名单补充角色攻略候选",
      )
    }
    this.mtimeMs = stat.mtimeMs
    return this.cache
  }

  invalidate() {
    this.cache = null
    this.mtimeMs = -1
  }

  resolveApiKey(config) {
    const direct = String(config.api.apiKey || "").trim()
    if (direct) return direct
    const envName = String(config.api.apiKeyEnv || "").trim()
    return envName ? String(this.env[envName] || "").trim() : ""
  }

  resolveWebSearchApiKey(config) {
    const webSearch = config.knowledge.webSearch
    const direct = String(webSearch.apiKey || "").trim()
    if (direct) return direct
    const envName = String(webSearch.apiKeyEnv || "").trim()
    return envName ? String(this.env[envName] || "").trim() : ""
  }

  validate(config) {
    const errors = []
    if (!config.enabled) return errors

    let url
    try {
      url = new URL(config.api.baseUrl)
    } catch {
      errors.push("api.baseUrl 不是有效 URL")
    }

    if (url) {
      if (!["http:", "https:"].includes(url.protocol)) {
        errors.push("api.baseUrl 仅支持 http/https")
      }
      if (
        url.protocol === "http:" &&
        !isLoopback(url.hostname) &&
        !config.api.allowInsecureHttp
      ) {
        errors.push("非本机 HTTP 地址需要显式开启 api.allowInsecureHttp")
      }
    }

    if (!String(config.api.model || "").trim()) errors.push("尚未设置 api.model")
    if (!config.api.allowUnauthenticated && !this.resolveApiKey(config)) {
      errors.push("尚未设置 API Key")
    }

    const webSearch = config.knowledge.webSearch
    if (webSearch.enabled) {
      const configuredBaseUrl = String(webSearch.baseUrl || "").trim()
      const searchBaseUrl = configuredBaseUrl || config.api.baseUrl
      if (!searchBaseUrl) {
        errors.push("knowledge.webSearch.baseUrl 尚未设置")
      } else {
        let searchUrl
        try {
          searchUrl = new URL(searchBaseUrl)
        } catch {
          errors.push("knowledge.webSearch.baseUrl 不是有效 URL")
        }
        if (searchUrl) {
          if (!["http:", "https:"].includes(searchUrl.protocol)) {
            errors.push("knowledge.webSearch.baseUrl 仅支持 http/https")
          }
          if (
            searchUrl.protocol === "http:" &&
            !isLoopback(searchUrl.hostname) &&
            !webSearch.allowInsecureHttp
          ) {
            errors.push(
              "非本机联网搜索 HTTP 地址需要显式开启 knowledge.webSearch.allowInsecureHttp",
            )
          }
        }
      }
    }

    return errors
  }

  publicStatus(config) {
    return {
      enabled: config.enabled,
      baseUrl: redactUrl(config.api.baseUrl),
      endpoint: redactUrl(config.api.endpoint),
      model: config.api.model || "(未设置)",
      hasApiKey: Boolean(this.resolveApiKey(config)),
      responseFormat: config.api.responseFormat,
      visionEnabled: config.vision.enabled,
      visionMaxImages: config.vision.maxImages,
      knowledgeEnabled: config.knowledge.enabled,
      knowledgeGuideVisionEnabled: config.knowledge.guideVisionEnabled,
      webSearchEnabled: config.knowledge.webSearch.enabled,
      errors: this.validate(config),
    }
  }
}

function redactUrl(value) {
  const text = String(value || "")
  try {
    const url = new URL(text)
    if (url.username) url.username = "[redacted]"
    if (url.password) url.password = "[redacted]"
    if (url.search) url.search = "?[redacted]"
    return url.toString()
  } catch {
    const queryIndex = text.indexOf("?")
    return queryIndex === -1 ? text : `${text.slice(0, queryIndex)}?[redacted]`
  }
}

export {
  mergeConfig,
  normalizeConfig,
  redactUrl,
  sameStringSet,
  migrateLegacyAutoExecuteAllowlist,
}
