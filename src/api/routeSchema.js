export const ROUTE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "mode",
    "candidateId",
    "slots",
    "confidence",
    "alternatives",
    "reply",
    "memorySummary",
  ],
  properties: {
    mode: {
      type: "string",
      enum: ["chat", "command", "clarify"],
    },
    candidateId: {
      anyOf: [{ type: "string", minLength: 1, maxLength: 128 }, { type: "null" }],
    },
    slots: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "value"],
        properties: {
          name: { type: "string", maxLength: 64 },
          value: { type: "string", maxLength: 200 },
        },
      },
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
    },
    alternatives: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["candidateId", "confidence"],
        properties: {
          candidateId: { type: "string", maxLength: 128 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    reply: {
      type: "string",
      maxLength: 2_000,
    },
    memorySummary: {
      type: "string",
      maxLength: 600,
    },
  },
}

function parseConfidence(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  if (value < 0 || value > 1) return null
  return value
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function hasExactKeys(value, expectedKeys) {
  if (!isRecord(value)) return false
  const actual = Object.keys(value)
  return (
    actual.length === expectedKeys.length &&
    expectedKeys.every(key => Object.hasOwn(value, key))
  )
}

function parseJsonText(text) {
  if (typeof text !== "string") throw new TypeError("模型响应不是文本")

  let value = text.trim()
  const fenced = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fenced) value = fenced[1].trim()

  try {
    return JSON.parse(value)
  } catch {
    const start = value.indexOf("{")
    const end = value.lastIndexOf("}")
    if (start === -1 || end <= start) throw new SyntaxError("模型响应中没有 JSON 对象")
    return JSON.parse(value.slice(start, end + 1))
  }
}

export function parseRouteResponse(text) {
  let raw
  try {
    raw = parseJsonText(text)
  } catch (error) {
    return { ok: false, error: error.message }
  }

  if (!isRecord(raw)) {
    return { ok: false, error: "路由结果必须是对象" }
  }

  const routeKeys = [
    "mode",
    "candidateId",
    "slots",
    "confidence",
    "alternatives",
    "reply",
  ]
  if (Object.hasOwn(raw, "memorySummary")) routeKeys.push("memorySummary")
  if (!hasExactKeys(raw, routeKeys)) {
    return { ok: false, error: "路由结果字段不完整或包含未知字段" }
  }

  if (!["chat", "command", "clarify"].includes(raw.mode)) {
    return { ok: false, error: "未知的路由模式" }
  }

  const confidence = parseConfidence(raw.confidence)
  if (confidence === null) return { ok: false, error: "confidence 无效" }

  const rawCandidateId = raw.candidateId
  if (
    rawCandidateId !== null &&
    (typeof rawCandidateId !== "string" ||
      !rawCandidateId.trim() ||
      rawCandidateId.length > 128)
  ) {
    return { ok: false, error: "candidateId 无效" }
  }
  const candidateId = rawCandidateId === null ? null : rawCandidateId.trim()
  if (raw.mode === "command" && candidateId === null) {
    return { ok: false, error: "命令模式缺少 candidateId" }
  }
  if (raw.mode !== "command" && candidateId !== null) {
    return { ok: false, error: `${raw.mode} 模式不应包含 candidateId` }
  }

  if (!Array.isArray(raw.slots) || raw.slots.length > 10) {
    return { ok: false, error: "slots 无效" }
  }

  const seenSlots = new Set()
  const slots = []
  for (const item of raw.slots) {
    if (
      !hasExactKeys(item, ["name", "value"]) ||
      typeof item.name !== "string" ||
      typeof item.value !== "string" ||
      item.name.length > 64 ||
      item.value.length > 200
    ) {
      return { ok: false, error: "slot 无效" }
    }
    const name = item.name.trim()
    const value = item.value.trim()
    if (!name || seenSlots.has(name)) return { ok: false, error: "slot 名称无效或重复" }
    seenSlots.add(name)
    slots.push({ name, value })
  }
  if (raw.mode !== "command" && slots.length) {
    return { ok: false, error: `${raw.mode} 模式不应包含 slots` }
  }

  if (!Array.isArray(raw.alternatives) || raw.alternatives.length > 5) {
    return { ok: false, error: "alternatives 无效" }
  }

  const alternatives = []
  for (const item of raw.alternatives) {
    if (
      !hasExactKeys(item, ["candidateId", "confidence"]) ||
      typeof item.candidateId !== "string" ||
      !item.candidateId.trim() ||
      item.candidateId.length > 128
    ) {
      return { ok: false, error: "alternative 无效" }
    }
    const id = item.candidateId.trim()
    const score = parseConfidence(item.confidence)
    if (!id || score === null) return { ok: false, error: "alternative 字段无效" }
    alternatives.push({ candidateId: id, confidence: score })
  }

  if (typeof raw.reply !== "string" || raw.reply.length > 2_000) {
    return { ok: false, error: "reply 无效" }
  }
  const reply = raw.reply.trim()
  if (raw.mode !== "command" && !reply) {
    return { ok: false, error: `${raw.mode} 模式缺少回复` }
  }

  const rawMemorySummary = raw.memorySummary ?? ""
  if (typeof rawMemorySummary !== "string" || rawMemorySummary.length > 600) {
    return { ok: false, error: "memorySummary 无效" }
  }
  const memorySummary = rawMemorySummary.trim()

  return {
    ok: true,
    data: {
      mode: raw.mode,
      candidateId,
      slots,
      confidence,
      alternatives,
      reply,
      memorySummary,
    },
  }
}

export { parseJsonText }
