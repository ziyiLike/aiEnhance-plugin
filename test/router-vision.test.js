import test from "node:test"
import assert from "node:assert/strict"
import {
  IntentRouter,
  userContentForPrompt,
} from "../src/routing/IntentRouter.js"

test("vision prompts use OpenAI Chat Completions image_url content parts", () => {
  const dataUrl = "data:image/png;base64,iVBORw0KGgo="
  const content = userContentForPrompt(
    { currentMessage: "图中有什么", attachedImageCount: 1 },
    [{ dataUrl }],
    "high",
  )

  assert.equal(content[0].type, "text")
  assert.match(content[0].text, /图中有什么/)
  assert.deepEqual(content[1], {
    type: "image_url",
    image_url: {
      url: dataUrl,
      detail: "high",
    },
  })
})

test("IntentRouter forwards quoted context and image parts while preserving structured routing", async () => {
  let messages
  const router = new IntentRouter({
    client: {
      async complete(input) {
        messages = input.messages
        return {
          content: JSON.stringify({
            mode: "chat",
            candidateId: null,
            slots: [],
            confidence: 0.99,
            alternatives: [],
            reply: "图中是一只猫。",
            memorySummary: "图片主体是一只银色短毛猫，圆脸、绿色眼睛。",
          }),
          model: "vision-model",
        }
      },
    },
    logger: { warn() {} },
  })

  const result = await router.route({
    text: "图中有什么",
    quotedText: "上一条消息的说明",
    images: [{ dataUrl: "data:image/png;base64,iVBORw0KGgo=" }],
    candidates: [],
    history: [],
    api: {},
    apiKey: "",
    context: {},
    vision: { detail: "auto" },
  })

  assert.equal(result.ok, true)
  assert.match(result.route.memorySummary, /银色短毛猫/)
  assert.equal(messages.at(-1).content.length, 2)
  assert.match(messages.at(-1).content[0].text, /"quotedMessage":"上一条消息的说明"/)
  assert.equal(messages.at(-1).content[1].type, "image_url")
  assert.equal("detail" in messages.at(-1).content[1].image_url, false)
})
