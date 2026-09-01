import test from "node:test"
import assert from "node:assert/strict"
import { parseJsonText, parseRouteResponse } from "../src/api/routeSchema.js"

test("parseJsonText accepts fenced JSON from compatible providers", () => {
  assert.deepEqual(parseJsonText('```json\n{"mode":"chat"}\n```'), {
    mode: "chat",
  })
})

test("parseRouteResponse validates and normalizes a command route", () => {
  const result = parseRouteResponse(
    JSON.stringify({
      mode: "command",
      candidateId: "waves.profile",
      slots: [{ name: "character", value: "今汐" }],
      confidence: 0.97,
      alternatives: [{ candidateId: "waves.guide", confidence: 0.2 }],
      reply: "",
      memorySummary: "",
    }),
  )

  assert.equal(result.ok, true)
  assert.equal(result.data.candidateId, "waves.profile")
  assert.equal(result.data.memorySummary, "")
  assert.deepEqual(result.data.slots, [{ name: "character", value: "今汐" }])
})

test("parseRouteResponse refuses incomplete or duplicated command data", () => {
  const missingCandidate = parseRouteResponse(
    JSON.stringify({
      mode: "command",
      candidateId: null,
      slots: [],
      confidence: 0.9,
      alternatives: [],
      reply: "",
    }),
  )
  assert.equal(missingCandidate.ok, false)

  const duplicateSlots = parseRouteResponse(
    JSON.stringify({
      mode: "command",
      candidateId: "waves.profile",
      slots: [
        { name: "character", value: "今汐" },
        { name: "character", value: "安可" },
      ],
      confidence: 0.9,
      alternatives: [],
      reply: "",
    }),
  )
  assert.equal(duplicateSlots.ok, false)
})

test("parseRouteResponse requires a user-facing reply for chat and clarify", () => {
  const result = parseRouteResponse(
    JSON.stringify({
      mode: "chat",
      candidateId: null,
      slots: [],
      confidence: 0.9,
      alternatives: [],
      reply: "",
    }),
  )
  assert.equal(result.ok, false)
})

test("parseRouteResponse fails closed on coerced types and unknown fields", () => {
  const stringConfidence = parseRouteResponse(
    JSON.stringify({
      mode: "chat",
      candidateId: null,
      slots: [],
      confidence: "0.9",
      alternatives: [],
      reply: "你好",
    }),
  )
  assert.equal(stringConfidence.ok, false)

  const extraField = parseRouteResponse(
    JSON.stringify({
      mode: "command",
      candidateId: "waves.sanity",
      slots: [],
      confidence: 0.9,
      alternatives: [],
      reply: "",
      command: "~体力",
    }),
  )
  assert.equal(extraField.ok, false)

  const invalidMemorySummary = parseRouteResponse(
    JSON.stringify({
      mode: "chat",
      candidateId: null,
      slots: [],
      confidence: 0.9,
      alternatives: [],
      reply: "你好",
      memorySummary: 123,
    }),
  )
  assert.equal(invalidMemorySummary.ok, false)
})
