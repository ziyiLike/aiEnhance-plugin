import test from "node:test"
import assert from "node:assert/strict"
import { SecretDetector } from "../src/security/SecretDetector.js"
import {
  PolicyEngine,
  selectedRetrievalStats,
} from "../src/security/PolicyEngine.js"
import { DEFAULT_CONFIG, cloneDefaults } from "../src/config/defaults.js"
import { CommandCatalog } from "../src/catalog/CommandCatalog.js"

test("SecretDetector blocks common credentials without flagging ordinary chat", () => {
  const detector = new SecretDetector()
  assert.equal(detector.inspect("今天天气怎么样").sensitive, false)
  assert.equal(detector.inspect("token: abcdefghijklmnopqrstuvwxyz123456").sensitive, true)
  assert.equal(
    detector.inspect(
      "eyJhbGciOiJIUzI1NiJ9.abcdefghijklmnopqrstuvwxyz.ABCDEFGHIJKLMNOPQRST",
    ).sensitive,
    true,
  )
  assert.equal(detector.inspect("ltoken_v2=secret-value").sensitive, true)
  assert.equal(
    detector.inspect(`登录信息${"a".repeat(100)}`).sensitive,
    true,
  )
  assert.equal(detector.redact("token: abcdefghijklmnopqrstuvwxyz123456"), "[REDACTED]")
})

test("PolicyEngine only auto-executes allowlisted read-only commands with a clear margin", () => {
  const config = cloneDefaults()
  const catalog = new CommandCatalog()
  catalog.configure(DEFAULT_CONFIG.commands)
  const candidate = catalog.find("waves.sanity")
  const policy = new PolicyEngine()
  const route = {
    candidateId: candidate.id,
    confidence: 0.98,
  }
  const searchResults = [
    { candidate, score: 0.8 },
    { candidate: catalog.find("waves.card"), score: 0.5 },
  ]

  assert.equal(
    policy.decide({ route, candidate, searchResults, config }).action,
    "execute",
  )

  const ambiguous = [
    { candidate, score: 0.8 },
    { candidate: catalog.find("xiaoyao.stamina"), score: 0.78 },
  ]
  assert.equal(
    policy.decide({ route, candidate, searchResults: ambiguous, config }).action,
    "confirm",
  )
})

test("PolicyEngine requires confirmation for side effects even at high confidence", () => {
  const config = cloneDefaults()
  const catalog = new CommandCatalog()
  catalog.configure(DEFAULT_CONFIG.commands)
  const candidate = catalog.find("waves.sign")
  const policy = new PolicyEngine()
  const decision = policy.decide({
    route: { candidateId: candidate.id, confidence: 1 },
    candidate,
    searchResults: [{ candidate, score: 1 }],
    config,
  })
  assert.equal(decision.action, "confirm")
  assert.equal(decision.reason, "side_effect_requires_confirmation")
})

test("selectedRetrievalStats reports negative margin when model skips the top result", () => {
  const catalog = new CommandCatalog()
  catalog.configure(DEFAULT_CONFIG.commands)
  const selected = catalog.find("waves.card")
  const top = catalog.find("waves.sanity")
  assert.deepEqual(
    selectedRetrievalStats(selected.id, [
      { candidate: top, score: 0.9 },
      { candidate: selected, score: 0.4 },
    ]),
    { selectedScore: 0.4, margin: -0.5 },
  )
})
