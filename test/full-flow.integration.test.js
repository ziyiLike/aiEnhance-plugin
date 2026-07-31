import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
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

test("full flow captures a character guide and answers a specific build question", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ai-enhance-guide-"))
  const api = await startMockApi({
    answerable: true,
    answer: "优先使用深林的记忆四件套。",
    confidence: 0.94,
    evidence: ["圣遗物推荐：深林的记忆"],
    reason: "攻略图有明确推荐",
  })
  t.after(async () => {
    await api.close()
    await fs.rm(directory, { recursive: true, force: true })
  })

  const config = cloneDefaults()
  Object.assign(config.api, {
    baseUrl: api.baseUrl,
    model: "mock-vision-model",
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
  const guidePath = path.join(directory, "temp", "strategy", "纳西妲.png")
  await fs.mkdir(path.dirname(guidePath), { recursive: true })
  await fs.writeFile(
    guidePath,
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  )

  let replay
  const earlySends = []
  const pluginLoader = {
    priority: [
      {
        key: "genshin/apps/strategy.js",
        name: "米游社攻略",
        plugin: {
          name: "米游社攻略",
          rule: [{ reg: /^#?(更新)?\S+攻略([1-7])?$/ }],
        },
      },
    ],
    async deal(event) {
      replay = event
      await event.reply([
        {
          type: "image",
          file: pathToFileURL(guidePath).href,
        },
      ])
    },
  }
  const replies = []
  const runtime = createRuntime({
    cwd: directory,
    pluginRoot,
    pluginLoader,
    redis: null,
    segment: {
      button(...rows) {
        return { type: "button", rows }
      },
    },
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
    msg: "纳西妲带什么圣遗物",
    raw_message: "纳西妲带什么圣遗物",
    sender: { user_id: "user", nickname: "tester" },
    group: {
      sendMsg(message) {
        earlySends.push(message)
      },
    },
    reply(message) {
      replies.push(message)
    },
  }

  assert.equal(await runtime.service.handle(event), true)
  assert.equal(replay.msg, "#纳西妲攻略")
  assert.equal(isReplayedEvent(replay), true)
  assert.deepEqual(earlySends, [])
  assert.equal(replies.length, 1)
  assert.match(String(replies[0][0]), /深林的记忆/)
  assert.equal(replies[0][1].type, "button")
  assert.equal(
    replies[0][1].rows[0][0].callback,
    "#纳西妲攻略",
  )
  assert.equal(
    Object.hasOwn(replies[0][1].rows[0][0], "permission"),
    false,
  )

  const request = api.getRequestBody()
  assert.equal(
    request.response_format.json_schema.name,
    "ai_enhance_knowledge_answer",
  )
  const content = request.messages.at(-1).content
  assert.equal(content[1].type, "image_url")
  assert.equal(content[1].image_url.detail, "high")
})

test("unanswerable guide vision falls back to the captured guide image", async t => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "ai-enhance-guide-fallback-"),
  )
  const api = await startMockApi({
    answerable: false,
    answer: "",
    confidence: 0.2,
    evidence: [],
    reason: "图片没有专武替代内容",
  })
  t.after(async () => {
    await api.close()
    await fs.rm(directory, { recursive: true, force: true })
  })

  const config = cloneDefaults()
  Object.assign(config.api, {
    baseUrl: api.baseUrl,
    model: "mock-vision-model",
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
  const guidePath = path.join(directory, "plugins", "guide", "遐蝶.png")
  await fs.mkdir(path.dirname(guidePath), { recursive: true })
  await fs.writeFile(
    guidePath,
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  )
  const guideMessage = [
    {
      type: "image",
      file: pathToFileURL(guidePath).href,
    },
  ]
  const pluginLoader = {
    priority: [
      {
        key: "StarRail-plugin/apps/strategy.js",
        name: "米游社星铁攻略",
        plugin: {
          name: "米游社星铁攻略",
          rule: [{ reg: /^\*(更新)?\S+攻略(\d+|all)?$/ }],
        },
      },
    ],
    async deal(event) {
      await event.reply(guideMessage)
    },
  }
  const replies = []
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
    msg: "遐蝶没有专武带什么光锥",
    raw_message: "遐蝶没有专武带什么光锥",
    sender: { user_id: "user", nickname: "tester" },
    group: { sendMsg() {} },
    reply(message) {
      replies.push(message)
    },
  }

  assert.equal(await runtime.service.handle(event), true)
  assert.deepEqual(replies, [guideMessage])
})

test("unanswerable guide vision uses the same model's native web search", async t => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "ai-enhance-guide-web-"),
  )
  const requests = []
  const server = http.createServer(async (request, response) => {
    let source = ""
    for await (const chunk of request) source += chunk
    const body = JSON.parse(source)
    requests.push({ url: request.url, body })
    response.writeHead(200, { "content-type": "application/json" })

    if (request.url.endsWith("/responses")) {
      response.end(
        JSON.stringify({
          model: "mock-native-search-model",
          output: [
            {
              type: "web_search_call",
              action: {
                sources: [
                  {
                    title: "遐蝶光锥攻略",
                    url: "https://guide.example.com/castorice",
                  },
                ],
              },
            },
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    answerable: true,
                    answer: "没有专武时可以使用测试光锥。",
                    confidence: 0.9,
                    evidence: ["遐蝶光锥攻略：替代光锥"],
                    reason: "联网资料有明确推荐",
                  }),
                  annotations: [],
                },
              ],
            },
          ],
        }),
      )
      return
    }

    response.end(
      JSON.stringify({
        model: "mock-vision-model",
        choices: [
          {
            message: {
              content: JSON.stringify({
                answerable: false,
                answer: "",
                confidence: 0.3,
                evidence: [],
                reason: "攻略图中没有替代光锥",
              }),
            },
            finish_reason: "stop",
          },
        ],
      }),
    )
  })
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address()
  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    await fs.rm(directory, { recursive: true, force: true })
  })

  const config = cloneDefaults()
  Object.assign(config.api, {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    model: "mock-native-search-model",
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
  const guidePath = path.join(directory, "plugins", "guide", "遐蝶.png")
  await fs.mkdir(path.dirname(guidePath), { recursive: true })
  await fs.writeFile(
    guidePath,
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  )

  const pluginLoader = {
    priority: [
      {
        key: "StarRail-plugin/apps/strategy.js",
        name: "米游社星铁攻略",
        plugin: {
          name: "米游社星铁攻略",
          rule: [{ reg: /^\*(更新)?\S+攻略(\d+|all)?$/ }],
        },
      },
    ],
    async deal(event) {
      await event.reply([
        {
          type: "image",
          file: pathToFileURL(guidePath).href,
        },
      ])
    },
  }
  const replies = []
  const runtime = createRuntime({
    cwd: directory,
    pluginRoot,
    pluginLoader,
    redis: null,
    segment: {
      button(...rows) {
        return { type: "button", rows }
      },
    },
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
    msg: "遐蝶没有专武带什么光锥",
    raw_message: "遐蝶没有专武带什么光锥",
    sender: { user_id: "user", nickname: "tester" },
    group: { sendMsg() {} },
    reply(message) {
      replies.push(message)
    },
  }

  assert.equal(await runtime.service.handle(event), true)
  assert.equal(requests.length, 2)
  assert.equal(requests[0].url, "/v1/chat/completions")
  assert.equal(requests[1].url, "/v1/responses")
  assert.equal(requests[1].body.tool_choice, "required")
  assert.deepEqual(requests[1].body.tools, [{ type: "web_search" }])
  assert.match(String(replies[0][0]), /测试光锥/)
  assert.match(String(replies[0][0]), /https:\/\/guide\.example\.com\/castorice/)
  assert.equal(replies[0][1].rows[0][0].callback, "*遐蝶攻略")
})
