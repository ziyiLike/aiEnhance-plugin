const PREFIX = "[aiEnhance-plugin]"

export function createLogger({ logger = globalThis.logger, Bot = globalThis.Bot } = {}) {
  function call(level, message) {
    const text = String(message)
    const prefixed = text.startsWith(PREFIX) ? text : `${PREFIX} ${text}`
    if (logger?.[level]) {
      logger[level](prefixed)
      return
    }
    if (level === "info" && logger?.mark) {
      logger.mark(prefixed)
      return
    }
    if (Bot?.makeLog) {
      Bot.makeLog(level, text, "aiEnhance-plugin")
      return
    }
    console[level === "debug" ? "log" : level]?.(prefixed)
  }

  return {
    debug: message => call("debug", message),
    info: message => call("info", message),
    warn: message => call("warn", message),
    error: message => call("error", message),
  }
}
