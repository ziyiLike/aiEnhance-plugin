import test from "node:test"
import assert from "node:assert/strict"
import { WebSearchService } from "../src/search/WebSearchService.js"

const intent = {
  game: "starrail",
  gameLabel: "星铁",
  character: "遐蝶",
  question: "遐蝶没有专武带什么",
}

function answer() {
  return {
    answerable: true,
    answer: "没有专武时可使用测试光锥。",
    confidence: 0.9,
    evidence: ["测试攻略：光锥替代推荐"],
    reason: "搜索结果有明确说明",
  }
}

test("model-native Responses web search is forced and preserves cited sources", async () => {
  let request
  const service = new WebSearchService({
    async fetchImpl(url, options) {
      request = { url, body: JSON.parse(options.body) }
      return new Response(
        JSON.stringify({
          model: "search-model",
          output: [
            {
              type: "web_search_call",
              action: {
                sources: [
                  {
                    title: "可信攻略",
                    url: "https://guide.example.com/role",
                  },
                ],
              },
            },
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify(answer()),
                  annotations: [
                    {
                      type: "url_citation",
                      title: "可信攻略",
                      url: "https://guide.example.com/role",
                    },
                  ],
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    },
    logger: { warn() {} },
  })

  const result = await service.answer({
    intent,
    config: {
      enabled: true,
      baseUrl: "",
      endpoint: "",
      model: "search-model",
      timeoutMs: 1_000,
      maxResults: 5,
      allowedDomains: ["example.com"],
      extraHeaders: {},
    },
    mainApi: {
      baseUrl: "https://api.openai.com/v1",
      model: "main-model",
      extraHeaders: {},
    },
    mainApiKey: "main-key",
    searchApiKey: "",
  })

  assert.equal(result.ok, true)
  assert.equal(result.provider, "model_web_search")
  assert.equal(result.sources[0].url, "https://guide.example.com/role")
  assert.equal(request.url, "https://api.openai.com/v1/responses")
  assert.equal(request.body.tool_choice, "required")
  assert.deepEqual(request.body.tools[0].filters.allowed_domains, [
    "example.com",
  ])
})
