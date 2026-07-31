import test from "node:test"
import assert from "node:assert/strict"
import { CommandCatalog } from "../src/catalog/CommandCatalog.js"
import { cloneDefaults } from "../src/config/defaults.js"
import {
  detectCharacterKnowledgeIntent,
  isCharacterKnowledgeQuestion,
} from "../src/knowledge/CharacterKnowledgeIntent.js"
import { parseKnowledgeAnswer } from "../src/knowledge/answerSchema.js"

function preparedCatalog() {
  const catalog = new CommandCatalog({ logger: { warn() {} } })
  catalog.configure(cloneDefaults().commands)
  return catalog
}

test("specific character build questions are detected without intercepting guide commands", () => {
  assert.equal(isCharacterKnowledgeQuestion("纳西妲带什么圣遗物"), true)
  assert.equal(isCharacterKnowledgeQuestion("遐蝶没有专武带什么"), true)
  assert.equal(isCharacterKnowledgeQuestion("椿的声骸怎么配"), true)
  assert.equal(isCharacterKnowledgeQuestion("给我一份纳西妲攻略"), false)
  assert.equal(isCharacterKnowledgeQuestion("#纳西妲攻略"), false)
})

test("knowledge intent uses the character whitelist and a canonical guide command", () => {
  const catalog = preparedCatalog()
  const text = "瑕蝶没有专武带什么光锥"
  const context = catalog.analyze(text)
  const intent = detectCharacterKnowledgeIntent({ text, context, catalog })

  assert.equal(intent.game, "starrail")
  assert.equal(intent.character, "遐蝶")
  assert.equal(intent.matched, "瑕蝶")
  assert.equal(intent.guide.candidateId, "starrail.guide")
  assert.equal(intent.guide.command, "*遐蝶攻略")
})

test("ambiguous or cross-game character context does not enter knowledge mode", () => {
  const catalog = preparedCatalog()
  const text = "原神遐蝶没有专武带什么"
  const context = catalog.analyze(text)
  assert.equal(context.conflict, true)
  assert.equal(
    detectCharacterKnowledgeIntent({ text, context, catalog }),
    null,
  )
})

test("knowledge answers are strictly parsed and cannot claim an empty answer", () => {
  const parsed = parseKnowledgeAnswer(
    JSON.stringify({
      answerable: true,
      answer: "优先使用深林的记忆四件套。",
      confidence: 0.91,
      evidence: ["圣遗物推荐：深林的记忆"],
      reason: "攻略图中有明确推荐",
    }),
  )
  assert.equal(parsed.ok, true)
  assert.equal(parsed.data.confidence, 0.91)

  assert.equal(
    parseKnowledgeAnswer(
      JSON.stringify({
        answerable: true,
        answer: "",
        confidence: 0.99,
        evidence: [],
        reason: "",
      }),
    ).ok,
    false,
  )
})
