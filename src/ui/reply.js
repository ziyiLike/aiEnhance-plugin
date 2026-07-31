function canUseButtons(segment, config) {
  return config.useButtons && typeof segment?.button === "function"
}

function buildButton(segment, event, command, label) {
  try {
    return segment.button([
      [
        {
          text: label,
          callback: command,
          permission: event.user_id,
        },
      ],
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
  { candidate, command, segment, config },
) {
  const title = candidate.risk === "write" ? "这个操作会修改状态" : "我还不能完全确定"
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
          permission: event.user_id,
        },
      ])
    } catch {}
  }

  let buttons
  try {
    buttons = segment.button(rows)
  } catch {}

  if (!buttons) return sendText(event, text, config)
  return event.reply([text, buttons], Boolean(config.quote))
}

export { canUseButtons, buildButton }
