import test from "node:test"
import assert from "node:assert/strict"
import { KnowledgeAnswerer } from "../src/knowledge/KnowledgeAnswerer.js"
import { KNOWLEDGE_ANSWER_SCHEMA } from "../src/knowledge/answerSchema.js"

const intent = {
  game: "genshin",
  gameLabel: "原神",
  character: "纳西妲",
  question: "纳西妲带什么圣遗物",
}

test("guide answerer sends dense guide screenshots as multimodal content", async () => {
  let request
  const answerer = new KnowledgeAnswerer({
    client: {
      async complete(input) {
        request = input
        return {
          model: "vision-model",
          content: JSON.stringify({
            answerable: true,
            answer: "优先使用深林的记忆四件套。",
            confidence: 0.93,
            evidence: ["圣遗物推荐：深林的记忆"],
            reason: "攻略图中有明确推荐",
          }),
        }
      },
    },
    logger: { warn() {} },
  })

  const result = await answerer.answerFromGuide({
    intent,
    images: [
      {
        dataUrl: "data:image/png;base64,iVBORw0KGgo=",
        mimeType: "image/png",
        byteLength: 8,
      },
    ],
    api: { model: "vision-model" },
    apiKey: "secret",
    detail: "high",
  })

  assert.equal(result.ok, true)
  assert.equal(result.answer.answerable, true)
  assert.equal(request.responseSchema, KNOWLEDGE_ANSWER_SCHEMA)
  assert.equal(request.responseSchemaName, "ai_enhance_knowledge_answer")
  const content = request.messages.at(-1).content
  assert.equal(content[1].type, "image_url")
  assert.equal(content[1].image_url.detail, "high")
})

test("guide answerer rejects model output that is not structurally grounded", async () => {
  const answerer = new KnowledgeAnswerer({
    client: {
      async complete() {
        return {
          content: JSON.stringify({
            answerable: true,
            answer: "",
            confidence: 0.99,
            evidence: [],
            reason: "",
          }),
        }
      },
    },
    logger: { warn() {} },
  })

  const result = await answerer.answerFromGuide({
    intent,
    images: [
      {
        dataUrl: "data:image/png;base64,iVBORw0KGgo=",
        mimeType: "image/png",
        byteLength: 8,
      },
    ],
    api: { model: "text-model" },
    apiKey: "",
  })

  assert.equal(result.ok, false)
})
