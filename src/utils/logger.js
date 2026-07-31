const PREFIX = "[aiEnhance-plugin]"

export function createLogger({ logger = globalThis.logger, Bot = globalThis.Bot } = {}) {
  function call(level, message) {
    const text = String(message)
    if (logger?.[level]) {
      logger[level](`${PREFIX} ${text}`)
      return
    }
    if (level === "info" && logger?.mark) {
      logger.mark(`${PREFIX} ${text}`)
      return
    }
    if (Bot?.makeLog) {
      Bot.makeLog(level, text, "aiEnhance-plugin")
      return
    }
    console[level === "debug" ? "log" : level]?.(`${PREFIX} ${text}`)
  }

  return {
    debug: message => call("debug", message),
    info: message => call("info", message),
    warn: message => call("warn", message),
    error: message => call("error", message),
  }
}
