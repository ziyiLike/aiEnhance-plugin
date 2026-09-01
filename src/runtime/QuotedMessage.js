function messageSegments(message) {
  if (Array.isArray(message)) return message
  if (message && typeof message === "object") return [message]
  return []
}

const QQ_QUOTED_MESSAGE_TYPE = 103
const MAX_EMBEDDED_DEPTH = 8
const MAX_EMBEDDED_ELEMENTS = 64
const QUOTE_SCENE_FIELDS = new Set(["msg_idx", "ref_msg_idx"])

function rawEvent(event) {
  return event?.raw && typeof event.raw === "object" ? event.raw : event
}

/**
 * QQ 的场景扩展值使用 key=value，其中索引和令牌本身可能带有 Base64 的 =。
 * 因此这里只在第一个等号处分割，并且绝不记录 auth_token。
 */
function messageSceneFields(event) {
  const ext = rawEvent(event)?.message_scene?.ext
  const fields = new Map()
  if (!Array.isArray(ext)) return fields

  for (const item of ext) {
    if (typeof item !== "string") continue
    const separator = item.indexOf("=")
    if (separator <= 0) continue
    const key = item.slice(0, separator).trim()
    if (!QUOTE_SCENE_FIELDS.has(key)) continue
    fields.set(key, item.slice(separator + 1).trim())
  }
  return fields
}

function embeddedElements(event) {
  const elements = rawEvent(event)?.msg_elements
  return Array.isArray(elements) ? elements : []
}

function hasEmbeddedQuote(event) {
  const raw = rawEvent(event)
  const fields = messageSceneFields(event)
  return (
    embeddedElements(event).length > 0 &&
    (fields.has("ref_msg_idx") || Number(raw?.message_type) === QQ_QUOTED_MESSAGE_TYPE)
  )
}

function findElementByIndex(elements, targetIndex) {
  if (!targetIndex) return null

  const pending = [...elements]
  const seen = new Set()
  let visited = 0

  while (pending.length && visited < MAX_EMBEDDED_ELEMENTS) {
    const element = pending.shift()
    if (!element || typeof element !== "object" || seen.has(element)) continue
    seen.add(element)
    visited++

    if (String(element.msg_idx || "") === targetIndex) return element
    if (Array.isArray(element.msg_elements)) pending.push(...element.msg_elements)
  }

  return null
}

function imageSegmentFromAttachment(attachment) {
  if (!attachment || typeof attachment !== "object") return null
  const contentType = String(
    attachment.content_type || attachment.contentType || "",
  ).toLowerCase()
  const url = typeof attachment.url === "string" ? attachment.url.trim() : ""
  if (!contentType.startsWith("image/") || !url) return null

  const segment = { type: "image", url }
  for (const field of ["size", "width", "height"]) {
    const value = Number(attachment[field])
    if (Number.isFinite(value) && value >= 0) segment[field] = value
  }
  return segment
}

function normalizeEmbeddedElements(elements) {
  const message = []
  const seen = new Set()
  let visited = 0

  function visit(element, depth) {
    if (
      depth > MAX_EMBEDDED_DEPTH ||
      visited >= MAX_EMBEDDED_ELEMENTS ||
      !element ||
      typeof element !== "object" ||
      seen.has(element)
    ) {
      return
    }

    seen.add(element)
    visited++

    if (typeof element.content === "string" && element.content.trim()) {
      message.push({ type: "text", text: element.content.trim() })
    }

    if (Array.isArray(element.attachments)) {
      for (const attachment of element.attachments) {
        const image = imageSegmentFromAttachment(attachment)
        if (image) message.push(image)
      }
    }

    if (Array.isArray(element.msg_elements)) {
      for (const nested of element.msg_elements) visit(nested, depth + 1)
    }
  }

  for (const element of elements) visit(element, 0)
  return message
}

/**
 * 新版 QQ 群消息会把引用内容放进 raw.msg_elements，而不是提供 getMsg 接口。
 * ref_msg_idx 能命中具体元素时只读取该元素；官方示例没有 msg_idx 时，回退到
 * 引用事件携带的全部元素，并排除明确属于当前消息的顶层元素。
 */
function embeddedQuotedMessage(event) {
  if (!hasEmbeddedQuote(event)) return null

  const fields = messageSceneFields(event)
  const elements = embeddedElements(event)
  const referenced = findElementByIndex(elements, fields.get("ref_msg_idx"))
  let selected = referenced ? [referenced] : elements

  if (!referenced && fields.has("msg_idx")) {
    const currentIndex = fields.get("msg_idx")
    const withoutCurrent = elements.filter(
      element => String(element?.msg_idx || "") !== currentIndex,
    )
    if (withoutCurrent.length) selected = withoutCurrent
  }

  const message = normalizeEmbeddedElements(selected)
  if (!message.length) return null
  return {
    message_id: fields.get("ref_msg_idx") || undefined,
    message,
  }
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
  return hasEmbeddedQuote(event) || Boolean(replyReader(event))
}

/**
 * 优先读取 QQ 事件内嵌的引用内容；没有内嵌内容时，再通过 Yunzai 为 reply
 * 消息段提供的接口回查。读取失败时继续处理当前提问，避免过期引用让整个
 * 消息处理链路报错。
 */
export async function resolveQuotedMessage(event, { logger = console } = {}) {
  const embedded = embeddedQuotedMessage(event)
  if (embedded) return embedded

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
