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
    policy.decide({ route, candidate, searchResults: ambiguous, config }).reason,
    "retrieval_margin_below_auto_threshold",
  )

  config.commands.autoExecuteAllowlist = []
  assert.equal(
    policy.decide({ route, candidate, searchResults, config }).reason,
    "candidate_not_allowlisted",
  )

  config.commands.autoExecuteAllowlist = [candidate.id]
  route.confidence = 0.9
  assert.equal(
    policy.decide({ route, candidate, searchResults, config }).reason,
    "confidence_below_auto_threshold",
  )
  assert.equal(
    policy.decide({ route, candidate, searchResults, config }).action,
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

test("PolicyEngine asks the user when the model skips a stronger local candidate", () => {
  const config = cloneDefaults()
  const catalog = new CommandCatalog()
  catalog.configure(DEFAULT_CONFIG.commands)
  const selected = catalog.find("xiaoyao.account_help")
  const top = catalog.find("xiaoyao.genshin_sign")
  const decision = new PolicyEngine().decide({
    route: { candidateId: selected.id, confidence: 0.99 },
    candidate: selected,
    searchResults: [
      { candidate: top, score: 0.8 },
      { candidate: selected, score: 0.5 },
    ],
    config,
  })

  assert.equal(decision.action, "clarify")
  assert.equal(decision.reason, "candidate_ranked_below_alternative")
})
