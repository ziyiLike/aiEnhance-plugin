import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import YAML from "yaml"
import { cloneDefaults } from "../src/config/defaults.js"
import { createRuntime } from "../src/runtime/createRuntime.js"
import { isReplayedEvent } from "../src/runtime/SafeDispatcher.js"

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const COMMAND_ROUTE = {
  mode: "command",
  candidateId: "waves.sanity",
  slots: [],
  confidence: 0.99,
  alternatives: [],
  reply: "",
}

async function startMockApi(route = COMMAND_ROUTE) {
  let requestBody
  const server = http.createServer(async (request, response) => {
    let body = ""
    for await (const chunk of request) body += chunk
    requestBody = JSON.parse(body)

    response.writeHead(200, { "content-type": "application/json" })
    response.end(
      JSON.stringify({
        model: "mock-router",
        choices: [
          {
            message: {
              content: JSON.stringify(route),
            },
            finish_reason: "stop",
          },
        ],
      }),
    )
  })
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address()

  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    getRequestBody: () => requestBody,
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

test("full flow routes through a mock OpenAI API and re-dispatches a safe command", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ai-enhance-flow-"))
  const api = await startMockApi()
  t.after(async () => {
    await api.close()
    await fs.rm(directory, { recursive: true, force: true })
  })

  const config = cloneDefaults()
  Object.assign(config.api, {
    baseUrl: api.baseUrl,
    model: "mock-router",
    allowUnauthenticated: true,
    responseFormat: "json_schema",
    retries: 0,
  })
  await fs.mkdir(path.join(directory, "config"), { recursive: true })
  await fs.writeFile(
    path.join(directory, "config", "aiEnhance.yaml"),
    YAML.stringify(config),
    "utf8",
  )

  let replay
  const pluginLoader = {
    priority: [
      {
        key: "waves-plugin/apps/Sanity.js",
        name: "鸣潮-日常数据",
        plugin: {
          name: "鸣潮-日常数据",
          rule: [{ reg: /^(～|~|鸣潮)(波片|体力|日常数据)$/ }],
        },
      },
    ],
    async deal(event) {
      replay = event
    },
  }
  const runtime = createRuntime({
    cwd: directory,
    pluginRoot,
    pluginLoader,
    redis: null,
    baseLogger: { info() {}, warn() {}, error() {} },
  })
  const event = {
    self_id: "bot",
    user_id: "user",
    message_type: "group",
    group_id: "group",
    isGroup: true,
    isPrivate: false,
    atBot: true,
    hasAlias: false,
    msg: "看看我的鸣潮体力",
    raw_message: "看看我的鸣潮体力",
    sender: { user_id: "user", nickname: "tester" },
    group: { sendMsg() {} },
    reply() {},
  }

  assert.equal(await runtime.service.handle(event), true)
  assert.equal(replay.msg, "~体力")
  assert.equal(replay.aiEnhanceCandidateId, "waves.sanity")
  assert.equal(isReplayedEvent(replay), true)

  const request = api.getRequestBody()
  assert.equal(request.model, "mock-router")
  assert.equal(request.response_format.type, "json_schema")
  assert.match(request.messages.at(-1).content, /waves\.sanity/)
})

test("full flow converts a QQ image and sends multimodal Chat Completions content", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ai-enhance-vision-"))
  const api = await startMockApi({
    mode: "chat",
    candidateId: null,
    slots: [],
    confidence: 0.99,
    alternatives: [],
    reply: "图中是一只猫。",
  })
  t.after(async () => {
    await api.close()
    await fs.rm(directory, { recursive: true, force: true })
  })

  const config = cloneDefaults()
  Object.assign(config.api, {
    baseUrl: api.baseUrl,
    model: "mock-vision-router",
    allowUnauthenticated: true,
    responseFormat: "json_schema",
    retries: 0,
  })
  await fs.mkdir(path.join(directory, "config"), { recursive: true })
  await fs.writeFile(
    path.join(directory, "config", "aiEnhance.yaml"),
    YAML.stringify(config),
    "utf8",
  )

  const pngSignature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ])
  const fetchImpl = async (input, options) => {
    const url = new URL(input)
    if (url.hostname === "multimedia.nt.qq.com.cn") {
      return new Response(pngSignature, {
        status: 200,
        headers: { "content-length": String(pngSignature.length) },
      })
    }
    return fetch(input, options)
  }

  const replies = []
  const runtime = createRuntime({
    cwd: directory,
    pluginRoot,
    pluginLoader: { priority: [], async deal() {} },
    redis: null,
    fetchImpl,
    baseLogger: { info() {}, warn() {}, error() {} },
  })
  const event = {
    self_id: "bot",
    user_id: "user",
    message_type: "group",
    group_id: "group",
    isGroup: true,
    isPrivate: false,
    atBot: true,
    hasAlias: false,
    msg: "图中有什么内容",
    raw_message:
      "图中有什么内容<image,url=https://multimedia.nt.qq.com.cn/download?rkey=secret>",
    message: [
      { type: "text", text: "图中有什么内容" },
      {
        type: "image",
        url: "https://multimedia.nt.qq.com.cn/download?rkey=secret",
        size: pngSignature.length,
      },
    ],
    sender: { user_id: "user", nickname: "tester" },
    group: { sendMsg() {} },
    reply(message) {
      replies.push(message)
    },
  }

  assert.equal(await runtime.service.handle(event), true)
  assert.match(String(replies[0]), /一只猫/)

  const request = api.getRequestBody()
  const content = request.messages.at(-1).content
  assert.ok(Array.isArray(content))
  assert.equal(content[1].type, "image_url")
  assert.equal(
    content[1].image_url.url,
    `data:image/png;base64,${pngSignature.toString("base64")}`,
  )
  assert.doesNotMatch(JSON.stringify(request), /rkey=secret/)
})
