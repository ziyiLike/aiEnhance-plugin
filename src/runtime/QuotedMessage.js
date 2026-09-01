function messageSegments(message) {
  if (Array.isArray(message)) return message
  if (message && typeof message === "object") return [message]
  return []
}

function replyReader(event) {
  if (typeof event?.getReply === "function") {
    return () => event.getReply()
  }

  if (event?.reply_id === undefined || event?.reply_id === null) return null
  if (typeof event.group?.getMsg === "function") {
    return () => event.group.getMsg(event.reply_id)
  }
  if (typeof event.friend?.getMsg === "function") {
    return () => event.friend.getMsg(event.reply_id)
  }
  return null
}

function safeErrorCode(error) {
  const value = error?.code || error?.name || "unknown"
  return String(value).replace(/[^\w.-]/g, "").slice(0, 80) || "unknown"
}

export function canResolveQuotedMessage(event) {
  return Boolean(replyReader(event))
}

/**
 * 通过 Yunzai 为 reply 消息段提供的接口回查原消息。
 * 读取失败时继续处理当前提问，避免过期引用让整个消息处理链路报错。
 */
export async function resolveQuotedMessage(event, { logger = console } = {}) {
  const read = replyReader(event)
  if (!read) return null

  try {
    const quoted = await read()
    if (Array.isArray(quoted)) return { message: quoted }
    return quoted && typeof quoted === "object" ? quoted : null
  } catch (error) {
    logger.warn?.(
      `[aiEnhance-plugin] 引用消息读取失败 code=${safeErrorCode(error)}`,
    )
    return null
  }
}

/**
 * 只把引用消息中的图片并入视觉输入。引用文字由路由器单独标记为上下文，
 * 不混入当前消息，避免引用中的命令被当成本次请求执行。
 */
export function withQuotedImages(event, quotedMessage) {
  const quotedImages = messageSegments(quotedMessage?.message).filter(
    segment => segment?.type === "image",
  )
  if (!quotedImages.length) return event

  return {
    ...event,
    message: [...messageSegments(event?.message), ...quotedImages],
  }
}

export { messageSegments, replyReader, safeErrorCode }
