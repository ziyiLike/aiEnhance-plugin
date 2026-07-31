const MEMORY_PREFIX = "Yz:aiEnhance:history"

function normalizePart(value) {
  return encodeURIComponent(String(value ?? "unknown")).slice(0, 160)
}

function conversationKey(e) {
  const scope = e.isGroup || e.group_id ? `group:${e.group_id}` : "private"
  return [
    MEMORY_PREFIX,
    normalizePart(e.self_id),
    normalizePart(scope),
    normalizePart(e.user_id),
  ].join(":")
}

function sanitizeMessages(messages, config) {
  return messages
    .filter(
      item =>
        item &&
        ["user", "assistant"].includes(item.role) &&
        typeof item.content === "string",
    )
    .map(item => ({
      role: item.role,
      content: item.content.slice(0, config.maxMessageChars),
    }))
    .slice(-config.maxMessages)
}

export class MemoryStore {
  constructor({ redis = null, logger = console } = {}) {
    this.redis = redis
    this.logger = logger
    this.fallback = new Map()
    this.fallbackAccessCount = 0
  }

  pruneFallback(now = Date.now()) {
    for (const [key, entry] of this.fallback) {
      if (entry.expiresAt <= now) this.fallback.delete(key)
    }
  }

  touchFallback() {
    // Redis 不可用时仍可能长期运行；周期性回收从未再次访问的过期会话。
    if (++this.fallbackAccessCount % 100 === 0) this.pruneFallback()
  }

  async get(e, config) {
    if (!config.enabled || config.maxMessages === 0) return []
    const key = conversationKey(e)

    if (this.redis?.get) {
      try {
        const value = await this.redis.get(key)
        if (!value) return []
        return sanitizeMessages(JSON.parse(value), config)
      } catch (error) {
        this.logger.warn?.(
          `[aiEnhance-plugin] Redis 会话读取失败：${error.message}`,
        )
      }
    }

    this.touchFallback()
    const entry = this.fallback.get(key)
    if (!entry || entry.expiresAt <= Date.now()) {
      this.fallback.delete(key)
      return []
    }
    return sanitizeMessages(entry.messages, config)
  }

  async append(e, userContent, assistantContent, config) {
    if (!config.enabled || config.maxMessages === 0) return
    const key = conversationKey(e)
    const current = await this.get(e, config)
    const next = sanitizeMessages(
      [
        ...current,
        { role: "user", content: String(userContent || "") },
        { role: "assistant", content: String(assistantContent || "") },
      ],
      config,
    )
    const serialized = JSON.stringify(next)

    if (this.redis?.set) {
      try {
        await this.redis.set(key, serialized, { EX: config.ttlSeconds })
        return
      } catch (firstError) {
        try {
          await this.redis.set(key, serialized, "EX", config.ttlSeconds)
          return
        } catch (secondError) {
          this.logger.warn?.(
            `[aiEnhance-plugin] Redis 会话写入失败：${secondError.message || firstError.message}`,
          )
        }
      }
    }

    this.fallback.set(key, {
      messages: next,
      expiresAt: Date.now() + config.ttlSeconds * 1_000,
    })
    this.touchFallback()
  }

  async clear(e) {
    const key = conversationKey(e)
    this.fallback.delete(key)
    if (this.redis?.del) {
      try {
        await this.redis.del(key)
      } catch (error) {
        this.logger.warn?.(
          `[aiEnhance-plugin] Redis 会话清理失败：${error.message}`,
        )
      }
    }
  }
}

export { MEMORY_PREFIX, conversationKey, sanitizeMessages }
