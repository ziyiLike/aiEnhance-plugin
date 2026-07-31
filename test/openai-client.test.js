import test from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import {
  OpenAICompatibleClient,
  OpenAITimeoutError,
  buildEndpoint,
  normalizeContent,
} from "../src/api/OpenAICompatibleClient.js"

async function startServer(handler) {
  const server = http.createServer(handler)
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  return {
    server,
    url: `http://127.0.0.1:${address.port}/v1`,
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

async function readJson(request) {
  let body = ""
  for await (const chunk of request) body += chunk
  return JSON.parse(body)
}

function api(baseUrl, overrides = {}) {
  return {
    baseUrl,
    endpoint: "/chat/completions",
    model: "test-model",
    timeoutMs: 1_000,
    retries: 0,
    temperature: 0.2,
    maxTokens: 100,
    maxTokensField: "max_tokens",
    responseFormat: "json_schema",
    extraHeaders: {},
    ...overrides,
  }
}

test("OpenAICompatibleClient sends Chat Completions request and extracts content", async t => {
  let captured
  const fixture = await startServer(async (request, response) => {
    captured = {
      url: request.url,
      authorization: request.headers.authorization,
      body: await readJson(request),
    }
    response.writeHead(200, { "content-type": "application/json" })
    response.end(
      JSON.stringify({
        model: "provider-model",
        choices: [
          {
            message: {
              role: "assistant",
              content: '{"mode":"chat","candidateId":null,"slots":[],"confidence":1,"alternatives":[],"reply":"你好"}',
            },
            finish_reason: "stop",
          },
        ],
      }),
    )
  })
  t.after(fixture.close)

  const client = new OpenAICompatibleClient()
  const result = await client.complete({
    api: api(fixture.url),
    apiKey: "secret-key",
    messages: [{ role: "user", content: "hello" }],
  })

  assert.equal(captured.url, "/v1/chat/completions")
  assert.equal(captured.authorization, "Bearer secret-key")
  assert.equal(captured.body.model, "test-model")
  assert.equal(captured.body.max_tokens, 100)
  assert.equal(captured.body.response_format.type, "json_schema")
  assert.equal(result.model, "provider-model")
  assert.match(result.content, /你好/)
})

test("auto response format falls back from json_schema to json_object", async t => {
  const modes = []
  const fixture = await startServer(async (request, response) => {
    const body = await readJson(request)
    modes.push(body.response_format?.type || "none")
    if (body.response_format?.type === "json_schema") {
      response.writeHead(400, { "content-type": "application/json" })
      response.end(JSON.stringify({ error: { message: "response_format unsupported" } }))
      return
    }

    response.writeHead(200, { "content-type": "application/json" })
    response.end(
      JSON.stringify({
        choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }],
      }),
    )
  })
  t.after(fixture.close)

  const client = new OpenAICompatibleClient({ logger: { warn() {} } })
  const result = await client.complete({
    api: api(fixture.url, { responseFormat: "auto" }),
    messages: [{ role: "user", content: "hello" }],
  })

  assert.deepEqual(modes, ["json_schema", "json_object"])
  assert.equal(result.responseFormatMode, "json_object")
})

test("OpenAICompatibleClient aborts a timed out request", async t => {
  const fixture = await startServer((_request, response) => {
    setTimeout(() => {
      if (!response.destroyed) {
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ choices: [{ message: { content: "{}" } }] }))
      }
    }, 150)
  })
  t.after(fixture.close)

  const client = new OpenAICompatibleClient()
  await assert.rejects(
    client.complete({
      api: api(fixture.url, { timeoutMs: 30 }),
      messages: [{ role: "user", content: "hello" }],
    }),
    OpenAITimeoutError,
  )
})

test("endpoint and multipart text normalization are compatibility friendly", () => {
  assert.equal(
    buildEndpoint("https://example.com/v1/", "/chat/completions"),
    "https://example.com/v1/chat/completions",
  )
  assert.equal(
    normalizeContent([
      { type: "text", text: "a" },
      { type: "image", image_url: "ignored" },
      "b",
    ]),
    "ab",
  )
})

test("max_completion_tokens can be selected for newer compatible models", async t => {
  let captured
  const fixture = await startServer(async (request, response) => {
    captured = await readJson(request)
    response.writeHead(200, { "content-type": "application/json" })
    response.end(
      JSON.stringify({
        choices: [{ message: { content: "{}" }, finish_reason: "stop" }],
      }),
    )
  })
  t.after(fixture.close)

  const client = new OpenAICompatibleClient()
  await client.complete({
    api: api(fixture.url, {
      maxTokensField: "max_completion_tokens",
      temperature: null,
    }),
    messages: [{ role: "user", content: "hello" }],
  })

  assert.equal(captured.max_completion_tokens, 100)
  assert.equal("max_tokens" in captured, false)
  assert.equal("temperature" in captured, false)
})
