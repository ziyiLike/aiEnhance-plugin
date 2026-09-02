export const BUTTON_LABEL_MAX_LENGTH = 18

export function compactButtonLabel(value, maxLength = BUTTON_LABEL_MAX_LENGTH) {
  const text = String(value || "").trim().replace(/\s+/g, " ")
  const semanticClause = text.split(/[；;。！？\r\n]/u, 1)[0].trim() || text
  const characters = [...semanticClause]
  if (characters.length <= maxLength) return semanticClause
  if (maxLength <= 1) return characters.slice(0, maxLength).join("")
  return `${characters.slice(0, maxLength - 1).join("")}…`
}

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
    ["write", "sensitive", "admin"].includes(candidate.risk)
  const needsExplicitConfirmation = [
    "auto_execute_disabled",
    "candidate_requires_confirmation",
    "candidate_not_allowlisted",
  ].includes(decision?.reason)
  const careReason =
    candidate.risk === "sensitive"
      ? "涉及账号敏感信息"
      : candidate.risk === "admin"
        ? "需要主人或群管理权限"
        : "会更改账号或功能状态"
  const introduction = requiresCare
    ? `「${description}」${careReason}。为避免误操作，请确认后再继续。`
    : needsExplicitConfirmation
      ? `我理解你是想${description}。这个功能需要你确认后才能继续。`
      : `我理解你是想${description}。如果没理解错，点一下确认我就帮你处理。`
  const fallbackText = `${introduction}\n你也可以直接发送：${command}`

  if (!canUseButtons(segment, config)) {
    return sendText(event, fallbackText, config)
  }

  const buttonLabel = compactButtonLabel(
    `${requiresCare ? "确认：" : "执行："}${command}`,
  )
  const button = buildButton(segment, command, buttonLabel)
  if (!button) return sendText(event, fallbackText, config)
  return event.reply([fallbackText, button], Boolean(config.quote))
}

export async function sendClarification(
  event,
  { message, suggestions = [], segment, config },
) {
  const text = String(message || "我还不确定你想使用哪个功能，请再具体一点。")
  const buildable = suggestions.filter(item => item.command).slice(0, 5)
  const commandLines = buildable.map(item => {
    const description = String(item.description || "").split(
      /[；;。！？\r\n]/u,
      1,
    )[0]
    // `- #命令` 会被 QQ Markdown 解析成列表内标题，导致整行异常加粗。
    return `· ${item.command}${description ? `：${description}` : ""}`
  })
  const outputText = [text, ...commandLines].join("\n")

  if (!buildable.length || !canUseButtons(segment, config)) {
    return sendText(event, outputText, config)
  }

  const rows = []
  for (const item of buildable) {
    try {
      rows.push([
        {
          text: compactButtonLabel(item.command),
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

  if (!buttons) return sendText(event, outputText, config)
  return event.reply([outputText, buttons], Boolean(config.quote))
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
      ? buildButton(segment, command, compactButtonLabel(label))
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
