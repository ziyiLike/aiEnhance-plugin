const SECRET_PATTERNS = [
  {
    id: "named-secret",
    pattern:
      /(?:cookie|token|stoken|ltoken|cookie_token|authorization|api[_-]?key|app[_-]?secret|client[_-]?secret)\s*[:=：]\s*\S+/i,
  },
  {
    id: "mihoyo-cookie",
    pattern:
      /(?:ltoken_v2|ltuid_v2|account_mid_v2|account_id_v2|cookie_token_v2|stuid|stoken)=/i,
  },
  {
    id: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]{10,})?\b/,
  },
  {
    id: "authorization",
    pattern: /\b(?:bearer|basic)\s+[A-Za-z0-9+/_=.-]{20,}\b/i,
  },
  {
    id: "qqbot-credentials",
    pattern: /#?[Qq]+[Bb]ot设置\s*\d+:\d+:[^:\s]{8,}:[^:\s]{8,}/,
  },
  {
    id: "long-opaque-value",
    pattern: /(?:[A-Fa-f0-9]{64,}|[A-Za-z0-9+/_-]{80,}={0,2})/,
  },
]

export class SecretDetector {
  inspect(text) {
    const value = String(text || "")
    const matches = SECRET_PATTERNS.filter(item => item.pattern.test(value)).map(item => item.id)
    return {
      sensitive: matches.length > 0,
      matches,
    }
  }

  redact(text) {
    let value = String(text || "")
    for (const item of SECRET_PATTERNS) {
      const flags = item.pattern.flags.includes("g")
        ? item.pattern.flags
        : `${item.pattern.flags}g`
      value = value.replace(new RegExp(item.pattern.source, flags), "[REDACTED]")
    }
    return value
  }
}

export { SECRET_PATTERNS }
