function canUseButtons(segment, config) {
  return config.useButtons && typeof segment?.button === "function"
}

function buildButton(segment, command, label) {
  try {
    return segment.button([
      {
        text: label,
        callback: command,
      },
    ])
  } catch {
    return null
  }
}

function buildImage(segment, image) {
  if (!image?.dataUrl) return null
  try {
    if (typeof segment?.image === "function") {
      return segment.image(image.dataUrl)
    }
  } catch {}
  return { type: "image", file: image.dataUrl }
}

export async function sendText(event, text, config) {
  if (!event?.reply || !text) return false
  return event.reply(String(text), Boolean(config.quote))
}

export async function sendConfirmation(
  event,
  { candidate, command, decision, segment, config },
) {
  const description = String(candidate.description || "这个功能")
    .split("；", 1)[0]
    .replace(/[。！？]+$/u, "")
  const requiresCare =
    decision?.reason === "side_effect_requires_confirmation" ||
    candidate.risk === "write"
  const needsExplicitConfirmation = [
    "auto_execute_disabled",
    "candidate_requires_confirmation",
    "candidate_not_allowlisted",
  ].includes(decision?.reason)
  const introduction = requiresCare
    ? `「${description}」会更改账号或功能状态。为避免误操作，请确认后再继续。`
    : needsExplicitConfirmation
      ? `我理解你是想${description}。这个功能需要你确认后才能继续。`
      : `我理解你是想${description}。如果没理解错，点一下确认我就帮你处理。`
  const fallbackText = `${introduction}\n你也可以直接发送：${command}`

  if (!canUseButtons(segment, config)) {
    return sendText(event, fallbackText, config)
  }

  const buttonLabel = `${requiresCare ? "确认" : "好的，"}${description}`.slice(
    0,
    32,
  )
  const button = buildButton(segment, command, buttonLabel)
  if (!button) return sendText(event, fallbackText, config)
  return event.reply([introduction, button], Boolean(config.quote))
}

export async function sendClarification(
  event,
  { message, suggestions = [], segment, config },
) {
  const text = String(message || "我还不确定你想使用哪个功能，请再具体一点。")
  const buildable = suggestions.filter(item => item.command).slice(0, 5)

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
  {
    text,
    command,
    label = "查看完整攻略",
    image,
    segment,
    config,
  },
) {
  if (!event?.reply || !text) return false

  const button =
    command && canUseButtons(segment, config)
      ? buildButton(segment, command, label.slice(0, 32))
      : null
  const outputText =
    command && !button ? `${String(text)}\n命令：${command}` : String(text)
  const message = [outputText]
  const imageSegment = buildImage(segment, image)
  if (imageSegment) message.push(imageSegment)
  if (button) message.push(button)

  if (message.length === 1) return sendText(event, outputText, config)
  return event.reply(message, Boolean(config.quote))
}

export { canUseButtons, buildButton, buildImage }
