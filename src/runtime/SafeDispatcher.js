export const REPLAY_SYMBOL = Symbol.for("aiEnhance-plugin.replayed")

export function isReplayedEvent(event) {
  return Boolean(event?.[REPLAY_SYMBOL])
}

function directReplyFor(event) {
  if (event.group?.sendMsg) return event.group.sendMsg.bind(event.group)
  if (event.friend?.sendMsg) return event.friend.sendMsg.bind(event.friend)
  if (event.reply?.bind) return event.reply.bind(event)
  return undefined
}

function captureSendTarget(target, captureReply) {
  if (!target || typeof target !== "object") return target
  return new Proxy(target, {
    get(source, property) {
      if (property === "sendMsg") return captureReply
      const value = Reflect.get(source, property, source)
      return typeof value === "function" ? value.bind(source) : value
    },
  })
}

function createReplayEvent(event, command, candidateId) {
  const replay = {
    raw: event.raw,
    bot: event.bot,
    self_id: event.self_id,
    post_type: "message",
    message_type: event.message_type,
    sub_type: event.sub_type,
    message_id: event.message_id,
    time: Math.floor(Date.now() / 1_000),
    user_id: event.user_id,
    sender: event.sender ? { ...event.sender } : { user_id: event.user_id },
    group_id: event.group_id,
    group_name: event.group_name,
    group: event.group,
    member: event.member,
    friend: event.friend,
    adapter_id: event.adapter_id,
    adapter_name: event.adapter_name,
    raw_message: command,
    msg: command,
    // message 为空时，Yunzai 不会把原始文本再次拼接到 msg，也不会命中同消息节流。
    message: null,
    atBot: true,
    at: event.at,
    isGroup: event.isGroup,
    isPrivate: event.isPrivate,
    isMaster: event.isMaster,
    game: event.game,
    img: event.img,
    file: event.file,
    source: event.source,
    hasReply: event.hasReply,
    reply_id: event.reply_id,
    getReply: event.getReply,
    reply: directReplyFor(event),
    aiEnhanceCandidateId: candidateId,
  }

  Object.defineProperty(replay, REPLAY_SYMBOL, {
    value: true,
    enumerable: false,
  })

  return replay
}

export class SafeDispatcher {
  constructor({ pluginLoader, logger = console }) {
    this.pluginLoader = pluginLoader
    this.logger = logger
  }

  async dispatch(event, { command, candidateId }) {
    if (!this.pluginLoader?.deal) {
      return { ok: false, error: "Yunzai 插件调度器不可用" }
    }

    const replay = createReplayEvent(event, command, candidateId)
    try {
      await this.pluginLoader.deal(replay)
      return { ok: true, replay }
    } catch (error) {
      this.logger.error?.(
        `[aiEnhance-plugin] 命令重派发失败：${error.stack || error.message}`,
      )
      return { ok: false, error: "命令重派发失败" }
    }
  }

  async capture(
    event,
    { command, candidateId },
    { timeoutMs = 45_000 } = {},
  ) {
    if (!this.pluginLoader?.deal) {
      return {
        ok: false,
        error: "Yunzai 插件调度器不可用",
        replies: [],
      }
    }

    const replies = []
    let closed = false
    const captureReply = async (message, quote = false) => {
      if (!closed && message !== undefined && message !== null) {
        replies.push({ message, quote: Boolean(quote) })
      }
      return {
        message_id: `aiEnhance-captured-${replies.length}`,
      }
    }
    const replay = createReplayEvent(event, command, candidateId)
    replay.reply = captureReply
    replay.group = captureSendTarget(event.group, captureReply)
    replay.friend = captureSendTarget(event.friend, captureReply)

    let timer
    try {
      await Promise.race([
        this.pluginLoader.deal(replay),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            const error = new Error("攻略命令执行超时")
            error.code = "capture_timeout"
            reject(error)
          }, timeoutMs)
        }),
      ])
      closed = true
      return { ok: true, replay, replies }
    } catch (error) {
      closed = true
      this.logger.error?.(
        `[aiEnhance-plugin] 攻略命令截获失败 code=${error?.code || "capture_failed"}`,
      )
      return {
        ok: false,
        error:
          error?.code === "capture_timeout"
            ? "攻略命令执行超时"
            : "攻略命令执行失败",
        replies,
      }
    } finally {
      clearTimeout(timer)
    }
  }
}

export { captureSendTarget, createReplayEvent, directReplyFor }
