import { parseJsonText } from "../api/routeSchema.js"

export const KNOWLEDGE_ANSWER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answerable", "answer", "confidence", "evidence", "reason"],
  properties: {
    answerable: { type: "boolean" },
    answer: { type: "string", maxLength: 2_000 },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
    },
    evidence: {
      type: "array",
      maxItems: 6,
      items: { type: "string", maxLength: 300 },
    },
    reason: { type: "string", maxLength: 500 },
  },
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

export function parseKnowledgeAnswer(text) {
  let raw
  try {
    raw = parseJsonText(text)
  } catch (error) {
    return { ok: false, error: error.message }
  }

  if (!isRecord(raw)) {
    return { ok: false, error: "攻略问答结果必须是对象" }
  }

  const expectedKeys = [
    "answerable",
    "answer",
    "confidence",
    "evidence",
    "reason",
  ]
  const actualKeys = Object.keys(raw)
  if (
    actualKeys.length !== expectedKeys.length ||
    !expectedKeys.every(key => Object.hasOwn(raw, key))
  ) {
    return { ok: false, error: "攻略问答结果字段不完整或包含未知字段" }
  }

  if (typeof raw.answerable !== "boolean") {
    return { ok: false, error: "answerable 无效" }
  }
  if (
    typeof raw.answer !== "string" ||
    raw.answer.length > KNOWLEDGE_ANSWER_SCHEMA.properties.answer.maxLength
  ) {
    return { ok: false, error: "answer 无效" }
  }
  if (
    typeof raw.confidence !== "number" ||
    !Number.isFinite(raw.confidence) ||
    raw.confidence < 0 ||
    raw.confidence > 1
  ) {
    return { ok: false, error: "confidence 无效" }
  }
  if (
    !Array.isArray(raw.evidence) ||
    raw.evidence.length >
      KNOWLEDGE_ANSWER_SCHEMA.properties.evidence.maxItems ||
    raw.evidence.some(
      item =>
        typeof item !== "string" ||
        item.length >
          KNOWLEDGE_ANSWER_SCHEMA.properties.evidence.items.maxLength,
    )
  ) {
    return { ok: false, error: "evidence 无效" }
  }
  if (
    typeof raw.reason !== "string" ||
    raw.reason.length > KNOWLEDGE_ANSWER_SCHEMA.properties.reason.maxLength
  ) {
    return { ok: false, error: "reason 无效" }
  }

  const answer = raw.answer.trim()
  if (raw.answerable && !answer) {
    return { ok: false, error: "可回答结果缺少 answer" }
  }

  return {
    ok: true,
    data: {
      answerable: raw.answerable,
      answer,
      confidence: raw.confidence,
      evidence: raw.evidence.map(item => item.trim()).filter(Boolean),
      reason: raw.reason.trim(),
    },
  }
}
