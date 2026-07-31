function canUseButtons(segment, config) {
  return config.useButtons && typeof segment?.button === "function"
}

function buildButton(segment, event, command, label) {
  try {
    return segment.button([
      {
        text: label,
        callback: command,
        permission: String(event.user_id),
      },
    ])
  } catch {
    return null
  }
}

export async function sendText(event, text, config) {
  if (!event?.reply || !text) return false
  return event.reply(String(text), Boolean(config.quote))
}

export async function sendConfirmation(
  event,
  { candidate, command, decision, segment, config },
) {
  const titles = {
    side_effect_requires_confirmation: "这个操作会修改状态",
    auto_execute_disabled: "命令已经识别，但自动执行已关闭",
    candidate_requires_confirmation: "命令已经识别，但该功能要求确认",
    candidate_not_allowlisted: "命令已经识别，但未加入自动执行白名单",
    confidence_below_auto_threshold:
      "命令已经匹配，但模型置信度未达到自动执行阈值",
    retrieval_score_below_auto_threshold:
      "命令已经匹配，但本地召回分数未达到自动执行阈值",
    retrieval_margin_below_auto_threshold:
      "命令已经匹配，但候选之间的分数差值不足",
  }
  const title =
    titles[decision?.reason] ||
    (candidate.risk === "write" ? "这个操作会修改状态" : "我还不能完全确定")
  const text = `${title}。你是想执行「${candidate.description}」吗？\n命令：${command}`

  if (!canUseButtons(segment, config)) return sendText(event, text, config)

  const button = buildButton(segment, event, command, `执行 ${command}`.slice(0, 32))
  if (!button) return sendText(event, text, config)
  return event.reply([text, button], Boolean(config.quote))
}

export async function sendClarification(
  event,
  { message, suggestions = [], segment, config },
) {
  const text = String(message || "我还不确定你想使用哪个功能，请再具体一点。")
  const buildable = suggestions.filter(item => item.command).slice(0, 3)

  if (!buildable.length || !canUseButtons(segment, config)) {
    const lines = buildable.map(item => `- ${item.description}：${item.command}`)
    return sendText(event, [text, ...lines].join("\n"), config)
  }

  const rows = []
  for (const item of buildable) {
    try {
      rows.push([
        {
          text: item.description.slice(0, 18),
          callback: item.command,
          permission: String(event.user_id),
        },
      ])
    } catch {}
  }

  let buttons
  try {
    // TRSS-Yunzai 的 segment.button(...data) 会把每个参数作为一行。
    // 这里必须展开 rows；直接传 rows 会多包一层，QQBot 无法解析按钮。
    buttons = segment.button(...rows)
  } catch {}

  if (!buttons) return sendText(event, text, config)
  return event.reply([text, buttons], Boolean(config.quote))
}

export async function sendKnowledgeAnswer(
  event,
  { text, command, label = "查看完整攻略", segment, config },
) {
  if (!command || !canUseButtons(segment, config)) {
    return sendText(event, text, config)
  }

  const button = buildButton(segment, event, command, label.slice(0, 32))
  if (!button) return sendText(event, text, config)
  return event.reply([String(text), button], Boolean(config.quote))
}

export async function sendCapturedReplies(event, replies, config) {
  if (!event?.reply || !Array.isArray(replies) || !replies.length) return false

  let sent = false
  for (let index = 0; index < replies.length; index++) {
    const reply = replies[index]
    if (reply?.message === undefined || reply?.message === null) continue
    await event.reply(
      reply.message,
      index === 0 ? Boolean(config.quote) : Boolean(reply.quote),
    )
    sent = true
  }
  return sent
}

export { canUseButtons, buildButton }
