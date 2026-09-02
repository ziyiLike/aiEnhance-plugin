import test from "node:test"
import assert from "node:assert/strict"
import { cloneDefaults } from "../src/config/defaults.js"
import { CommandCatalog } from "../src/catalog/CommandCatalog.js"
import { SecretDetector } from "../src/security/SecretDetector.js"
import { PolicyEngine } from "../src/security/PolicyEngine.js"
import { MemoryStore } from "../src/runtime/MemoryStore.js"
import { RequestGate } from "../src/runtime/RequestGate.js"
import {
  AiEnhanceService,
  errorSummary,
  extractText,
} from "../src/runtime/AiEnhanceService.js"
import { REPLAY_SYMBOL } from "../src/runtime/SafeDispatcher.js"
import {
  BUTTON_LABEL_MAX_LENGTH,
  compactButtonLabel,
} from "../src/ui/reply.js"

function event(overrides = {}) {
  const replies = []
  return {
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
    group: {
      sendMsg(message) {
        replies.push(message)
        return { message_id: "sent" }
      },
    },
    async reply(message) {
      replies.push(message)
      return { message_id: "reply" }
    },
    replies,
    ...overrides,
  }
}

function serviceFixture(
  routeFactory,
  { configMutator, segment, imageInput } = {},
) {
  const config = cloneDefaults()
  config.api.model = "test-model"
  config.api.apiKey = "test-key"
  config.reply.useButtons = false
  configMutator?.(config)

  const configManager = {
    errors: [],
    async load() {
      return config
    },
    validate() {
      return this.errors
    },
    resolveApiKey() {
      return "test-key"
    },
  }
  const catalog = new CommandCatalog({ logger: { warn() {} } })
  const calls = { router: 0, dispatch: 0, dispatched: [] }
  const router = {
    async route(input) {
      calls.router++
      return routeFactory(input)
    },
  }
  const pluginLoader = {
    priority: [
      {
        key: "waves-plugin/index.js",
        name: "鸣潮-日常数据",
        plugin: {
          rule: [
            { reg: /^(～|~|鸣潮)(波片|体力|日常数据)$/ },
            { reg: /^(～|~|鸣潮)签到$/ },
          ],
        },
      },
      {
        key: "miao-plugin/index.js",
        name: "喵喵:角色面板",
        plugin: { rule: [{ reg: /^#[^#]+面板$/ }] },
      },
      {
        key: "genshin/index.js",
        name: "米游社攻略",
        plugin: { rule: [{ reg: /^#?(更新)?\S+攻略([1-7])?$/ }] },
      },
      {
        key: "genshin/user.js",
        name: "用户绑定",
        plugin: {
          rule: [
            {
              reg: /^#(原神|星铁|绝区零)?绑定(uid)?(\s|\+)*[0-9]+$/i,
            },
          ],
        },
      },
      {
        key: "StarRail-plugin/index.js",
        name: "米游社星铁攻略",
        plugin: { rule: [{ reg: /^\*(更新)?\S+攻略(\d+|all)?$/ }] },
      },
      {
        key: "xiaoyao-cvs-plugin/index.js",
        name: "xiaoyao-cvs-plugin",
        plugin: { rule: [{ reg: /.+/ }] },
      },
    ],
  }
  const dispatcher = {
    result: { ok: true },
    async dispatch(_event, payload) {
      calls.dispatch++
      calls.dispatched.push(payload)
      return this.result
    },
  }
  const logger = { info() {}, warn() {}, error() {} }
  const service = new AiEnhanceService({
    configManager,
    catalog,
    router,
    policy: new PolicyEngine(),
    secretDetector: new SecretDetector(),
    memory: new MemoryStore({ logger }),
    gate: new RequestGate(),
    dispatcher,
    imageInput,
    pluginLoader,
    segment,
    logger,
  })

  return { service, calls, config, configManager, pluginLoader, dispatcher }
}

test("button labels keep a complete semantic clause within the adapter limit", () => {
  assert.equal(
    compactButtonLabel("查看米游社账号绑定与签到配置教程；不会提交凭据"),
    "查看米游社账号绑定与签到配置教程",
  )
  const truncated = compactButtonLabel("这是一个没有自然停顿而且明显超过限制的按钮说明文案")
  assert.equal([...truncated].length, BUTTON_LABEL_MAX_LENGTH)
  assert.match(truncated, /…$/)
})

test("API error summaries do not log provider-returned request text", () => {
  const error = new Error("provider echoed private user text")
  error.name = "OpenAIHttpError"
  error.status = 400
  error.code = "invalid_request"

  assert.equal(
    errorSummary(error),
    "OpenAIHttpError status=400 code=invalid_request",
  )
  assert.doesNotMatch(errorSummary(error), /private user text/)
})

test("text extraction never sends a temporary image URL from raw_message", () => {
  assert.equal(
    extractText({
      raw_message:
        "图中有什么<image,url=https://multimedia.nt.qq.com.cn/download?rkey=secret>",
      message: [
        { type: "text", text: "图中有什么" },
        {
          type: "image",
          url: "https://multimedia.nt.qq.com.cn/download?rkey=secret",
        },
      ],
    }),
    "图中有什么",
  )
  assert.equal(
    extractText({
      raw_message:
        "<image,url=https://multimedia.nt.qq.com.cn/download?rkey=secret>",
      message: [
        {
          type: "image",
          url: "https://multimedia.nt.qq.com.cn/download?rkey=secret",
        },
      ],
    }),
    "",
  )
})

test("high-confidence safe intent is generated locally and dispatched once", async () => {
  const fixture = serviceFixture(async () => ({
    ok: true,
    route: {
      mode: "command",
      candidateId: "waves.sanity",
      slots: [],
      confidence: 0.99,
      alternatives: [],
      reply: "",
    },
    responseMeta: { model: "test-model" },
  }))
  const currentEvent = event()

  assert.equal(await fixture.service.handle(currentEvent), true)
  assert.equal(fixture.calls.router, 1)
  assert.equal(fixture.calls.dispatch, 1)
  assert.deepEqual(fixture.calls.dispatched[0], {
    command: "~体力",
    candidateId: "waves.sanity",
  })
  assert.deepEqual(currentEvent.replies, [])
})

test("a clear character alias guide request is canonicalized and dispatched", async () => {
  const fixture = serviceFixture(async input => {
    assert.equal(input.context.characters[0].matched, "木偶")
    assert.equal(input.context.characters[0].character, "桑多涅")
    assert.equal(input.candidates[0].candidate.id, "genshin.guide")
    return {
      ok: true,
      route: {
        mode: "command",
        candidateId: "genshin.guide",
        slots: [{ name: "character", value: "木偶" }],
        confidence: 0.99,
        alternatives: [],
        reply: "",
      },
      responseMeta: { model: "test-model" },
    }
  })
  const currentEvent = event({
    msg: "给我木偶的攻略",
    raw_message: "给我木偶的攻略",
  })

  assert.equal(await fixture.service.handle(currentEvent), true)
  assert.deepEqual(fixture.calls.dispatched, [
    {
      command: "#桑多涅攻略",
      candidateId: "genshin.guide",
    },
  ])
})

test("confirmation keeps internal policy details out of the user-facing reply", async () => {
  const fixture = serviceFixture(
    async () => ({
      ok: true,
      route: {
        mode: "command",
        candidateId: "genshin.guide",
        slots: [{ name: "character", value: "纳西妲" }],
        confidence: 0.99,
        alternatives: [],
        reply: "",
      },
      responseMeta: { model: "test-model" },
    }),
    {
      configMutator(config) {
        config.commands.autoExecuteAllowlist =
          config.commands.autoExecuteAllowlist.filter(
            id => id !== "genshin.guide",
          )
      },
    },
  )
  const currentEvent = event({
    msg: "给我一份纳西妲攻略",
    raw_message: "给我一份纳西妲攻略",
  })

  assert.equal(await fixture.service.handle(currentEvent), true)
  assert.equal(fixture.calls.dispatch, 0)
  assert.match(String(currentEvent.replies[0]), /我理解你是想查询原神指定角色的培养攻略图/)
  assert.doesNotMatch(
    String(currentEvent.replies[0]),
    /白名单|阈值|置信度|召回分数/,
  )
})

test("group messages without @ or alias are ignored even when Yunzai might accept them", async () => {
  const fixture = serviceFixture(async () => {
    throw new Error("router should not run")
  })
  const currentEvent = event({ atBot: false, hasAlias: false })
  assert.equal(await fixture.service.handle(currentEvent), false)
  assert.equal(fixture.calls.router, 0)
})

test("private messages can start a conversation without @", async () => {
  const fixture = serviceFixture(async () => ({
    ok: true,
    route: {
      mode: "chat",
      candidateId: null,
      slots: [],
      confidence: 1,
      alternatives: [],
      reply: "私聊已收到",
    },
    responseMeta: { model: "test-model" },
  }))
  const currentEvent = event({
    message_type: "private",
    group_id: undefined,
    isGroup: false,
    isPrivate: true,
    atBot: false,
    friend: { sendMsg() {} },
  })

  assert.equal(await fixture.service.handle(currentEvent), true)
  assert.equal(fixture.calls.router, 1)
})

test("group allowlist accepts the adapter's normalized group id", async () => {
  const fixture = serviceFixture(
    async () => ({
      ok: true,
      route: {
        mode: "chat",
        candidateId: null,
        slots: [],
        confidence: 1,
        alternatives: [],
        reply: "ok",
      },
      responseMeta: { model: "test-model" },
    }),
    {
      configMutator(config) {
        config.trigger.enabledGroups = ["raw-group"]
      },
    },
  )
  const currentEvent = event({
    group_id: "bot:raw-group",
    group: {
      group_id: "raw-group",
      sendMsg() {},
    },
  })

  assert.equal(await fixture.service.handle(currentEvent), true)
  assert.equal(fixture.calls.router, 1)
})

test("replayed commands never enter AI a second time", async () => {
  const fixture = serviceFixture(async () => {
    throw new Error("router should not run")
  })
  const currentEvent = event()
  Object.defineProperty(currentEvent, REPLAY_SYMBOL, { value: true })
  assert.equal(await fixture.service.handle(currentEvent), false)
  assert.equal(fixture.calls.router, 0)
})

test("sensitive input is blocked before it reaches the API", async () => {
  const fixture = serviceFixture(async () => {
    throw new Error("router should not run")
  })
  const currentEvent = event({
    msg: "我的 token: abcdefghijklmnopqrstuvwxyz123456",
  })

  assert.equal(await fixture.service.handle(currentEvent), true)
  assert.equal(fixture.calls.router, 0)
  assert.equal(fixture.calls.dispatch, 0)
  assert.match(String(currentEvent.replies[0]), /不会发送给 AI/)
})

test("normal chat is replied to and not dispatched", async () => {
  const fixture = serviceFixture(async () => ({
    ok: true,
    route: {
      mode: "chat",
      candidateId: null,
      slots: [],
      confidence: 0.95,
      alternatives: [],
      reply: "你好，有什么可以帮你？",
    },
    responseMeta: { model: "test-model" },
  }))
  const currentEvent = event({ msg: "你好呀" })

  assert.equal(await fixture.service.handle(currentEvent), true)
  assert.equal(fixture.calls.dispatch, 0)
  assert.match(String(currentEvent.replies[0]), /你好/)
})

test("router receives the complete compatible command catalog beyond local topK", async () => {
  const fixture = serviceFixture(
    async input => {
      const offeredIds = input.candidates.map(result => result.candidate.id)
      const likelyIds = input.likelyCandidates.map(result => result.candidate.id)

      assert.equal(likelyIds.length, 1)
      assert.equal(likelyIds.includes("xiaoyao.account_help"), false)
      assert.equal(offeredIds.includes("xiaoyao.account_help"), true)
      assert.ok(offeredIds.length > likelyIds.length)
      return {
        ok: true,
        route: {
          mode: "chat",
          candidateId: null,
          slots: [],
          confidence: 0.95,
          alternatives: [],
          reply: "你可以告诉我想使用哪项原神功能。",
        },
        responseMeta: { model: "test-model" },
      }
    },
    {
      configMutator(config) {
        config.routing.topK = 1
      },
    },
  )
  const currentEvent = event({
    msg: "原神有什么功能",
    raw_message: "原神有什么功能",
  })

  assert.equal(await fixture.service.handle(currentEvent), true)
  assert.equal(fixture.calls.router, 1)
})

test("QQ image segments are prepared and forwarded to the router", async () => {
  const preparedImage = {
    dataUrl: "data:image/png;base64,iVBORw0KGgo=",
    mimeType: "image/png",
    byteLength: 8,
  }
  let routeInput
  const fixture = serviceFixture(
    async input => {
      routeInput = input
      return {
        ok: true,
        route: {
          mode: "chat",
          candidateId: null,
          slots: [],
          confidence: 0.99,
          alternatives: [],
          reply: "图中是一只猫。",
        },
        responseMeta: { model: "vision-model" },
      }
    },
    {
      imageInput: {
        async prepare() {
          return {
            hadImages: true,
            images: [preparedImage],
            failures: [],
          }
        },
      },
    },
  )
  const currentEvent = event({
    msg: "图中有什么内容",
    raw_message: "图中有什么内容<image>",
    message: [
      { type: "at", qq: "bot" },
      { type: "text", text: "图中有什么内容" },
      {
        type: "image",
        url: "https://multimedia.nt.qq.com.cn/download?token=redacted",
        size: 37_690,
      },
    ],
  })

  assert.equal(await fixture.service.handle(currentEvent), true)
  assert.deepEqual(routeInput.images, [preparedImage])
  assert.equal(routeInput.vision, fixture.config.vision)
  assert.match(String(currentEvent.replies[0]), /一只猫/)
})

test("a quoted image is resolved and forwarded with quoted text context", async () => {
  const preparedImage = {
    dataUrl: "data:image/png;base64,iVBORw0KGgo=",
    mimeType: "image/png",
    byteLength: 8,
  }
  let preparedEvent
  let routeInput
  let getReplyCalls = 0
  const fixture = serviceFixture(
    async input => {
      routeInput = input
      return {
        ok: true,
        route: {
          mode: "chat",
          candidateId: null,
          slots: [],
          confidence: 0.99,
          alternatives: [],
          reply: "这是无边游原的题目答案。",
        },
        responseMeta: { model: "vision-model" },
      }
    },
    {
      imageInput: {
        async prepare(inputEvent) {
          preparedEvent = inputEvent
          return {
            hadImages: true,
            images: [preparedImage],
            failures: [],
          }
        },
      },
    },
  )
  const currentEvent = event({
    msg: "这个什么答案",
    raw_message: "[回复]@机器人 这个什么答案",
    reply_id: "quoted-message",
    message: [
      { type: "reply", id: "quoted-message" },
      { type: "at", qq: "bot" },
      { type: "text", text: "这个什么答案" },
    ],
    async getReply() {
      getReplyCalls++
      return {
        message_id: "quoted-message",
        message: [
          { type: "text", text: "无边游原（字面意思）" },
          {
            type: "image",
            url: "https://multimedia.nt.qq.com.cn/download?token=quoted",
          },
        ],
      }
    },
  })

  assert.equal(await fixture.service.handle(currentEvent), true)
  assert.equal(getReplyCalls, 1)
  assert.equal(
    preparedEvent.message.filter(segment => segment.type === "image").length,
    1,
  )
  assert.equal(routeInput.text, "这个什么答案")
  assert.equal(routeInput.quotedText, "无边游原（字面意思）")
  assert.deepEqual(routeInput.images, [preparedImage])
  assert.match(String(currentEvent.replies[0]), /无边游原/)
})

test("a QQ embedded quoted image reaches vision without getReply", async () => {
  const preparedImage = {
    dataUrl: "data:image/jpeg;base64,/9j/",
    mimeType: "image/jpeg",
    byteLength: 3,
  }
  let preparedEvent
  let routeInput
  const fixture = serviceFixture(
    async input => {
      routeInput = input
      return {
        ok: true,
        route: {
          mode: "chat",
          candidateId: null,
          slots: [],
          confidence: 0.99,
          alternatives: [],
          reply: "引用图片里是一只猫。",
        },
        responseMeta: { model: "vision-model" },
      }
    },
    {
      imageInput: {
        async prepare(inputEvent) {
          preparedEvent = inputEvent
          return {
            hadImages: true,
            images: [preparedImage],
            failures: [],
          }
        },
      },
    },
  )
  const quotedImageUrl =
    "https://multimedia.nt.qq.com.cn/download?token=embedded-quoted"
  const currentEvent = event({
    msg: "图中有什么内容",
    raw_message: "图中有什么内容",
    message: [
      { type: "at", qq: "bot" },
      { type: "text", text: "图中有什么内容" },
    ],
    raw: {
      message_type: "group",
      message_scene: {
        ext: [
          "msg_idx=REFIDX_current==",
          "auth_token=must-not-be-used",
          "ref_msg_idx=TMP_quoted==",
        ],
      },
      msg_elements: [
        {
          msg_idx: "REFIDX_current==",
          content: "当前消息不应混入引用内容",
        },
        {
          message_type: 103,
          msg_elements: [
            {
              msg_idx: "TMP_quoted==",
              content: "一张猫照片",
              attachments: [
                {
                  content_type: "image/jpeg",
                  filename: "cat.jpg",
                  url: quotedImageUrl,
                  width: 1280,
                  height: 720,
                  size: 256_000,
                },
                {
                  content_type: "video/mp4",
                  url: "https://example.com/ignored.mp4",
                },
              ],
            },
          ],
        },
      ],
    },
  })

  assert.equal(await fixture.service.handle(currentEvent), true)
  assert.deepEqual(
    preparedEvent.message.filter(segment => segment.type === "image"),
    [
      {
        type: "image",
        url: quotedImageUrl,
        size: 256_000,
        width: 1280,
        height: 720,
      },
    ],
  )
  assert.equal(routeInput.text, "图中有什么内容")
  assert.equal(routeInput.quotedText, "一张猫照片")
  assert.deepEqual(routeInput.images, [preparedImage])
  assert.match(String(currentEvent.replies[0]), /一只猫/)
})

test("an image-only message reaches the model with a useful fallback prompt", async () => {
  let routeInput
  const fixture = serviceFixture(
    async input => {
      routeInput = input
      return {
        ok: true,
        route: {
          mode: "chat",
          candidateId: null,
          slots: [],
          confidence: 0.99,
          alternatives: [],
          reply: "图片内容已识别。",
        },
        responseMeta: { model: "vision-model" },
      }
    },
    {
      imageInput: {
        async prepare() {
          return {
            hadImages: true,
            images: [
              {
                dataUrl: "data:image/png;base64,iVBORw0KGgo=",
                mimeType: "image/png",
                byteLength: 8,
              },
            ],
            failures: [],
          }
        },
      },
    },
  )
  const currentEvent = event({
    msg: "",
    raw_message: "<image>",
    message: [{ type: "image", url: "https://example.com/image.png" }],
  })

  assert.equal(await fixture.service.handle(currentEvent), true)
  assert.equal(routeInput.text, "请描述用户发送的图片内容。")
  assert.deepEqual(routeInput.candidates, [])
})

test("an unreadable image fails locally instead of asking the model to guess", async () => {
  const fixture = serviceFixture(
    async () => {
      throw new Error("router should not run")
    },
    {
      imageInput: {
        async prepare() {
          return {
            hadImages: true,
            images: [],
            failures: [{ code: "download_failed" }],
          }
        },
      },
    },
  )
  const currentEvent = event({
    msg: "图中有什么",
    message: [{ type: "image", url: "https://example.com/image.png" }],
  })

  assert.equal(await fixture.service.handle(currentEvent), true)
  assert.equal(fixture.calls.router, 0)
  assert.match(String(currentEvent.replies[0]), /图片读取失败/)
})

test("vision compatibility errors produce an actionable model hint", async () => {
  const error = new Error("provider echoed the request")
  error.name = "OpenAIHttpError"
  error.status = 400
  const fixture = serviceFixture(
    async () => {
      throw error
    },
    {
      imageInput: {
        async prepare() {
          return {
            hadImages: true,
            images: [
              {
                dataUrl: "data:image/png;base64,iVBORw0KGgo=",
                mimeType: "image/png",
                byteLength: 8,
              },
            ],
            failures: [],
          }
        },
      },
    },
  )
  const currentEvent = event({
    msg: "图中有什么",
    message: [{ type: "image", url: "https://example.com/image.png" }],
  })

  assert.equal(await fixture.service.handle(currentEvent), true)
  assert.match(String(currentEvent.replies[0]), /不支持图片输入/)
})

test("binding help confirmation is conversational and hides routing internals", async () => {
  const fixture = serviceFixture(async () => ({
    ok: true,
    route: {
      mode: "command",
      candidateId: "genshin.bind_uid",
      slots: [],
      confidence: 0.8,
      alternatives: [],
      reply: "",
    },
    responseMeta: { model: "test-model" },
  }))
  const currentEvent = event({
    msg: "我怎么绑定原神？",
    raw_message: "我怎么绑定原神？",
  })

  assert.equal(await fixture.service.handle(currentEvent), true)
  assert.equal(fixture.calls.dispatch, 0)
  assert.match(
    String(currentEvent.replies[0]),
    /绑定原神游戏 UID/,
  )
  assert.match(String(currentEvent.replies[0]), /#绑定uid/)
  assert.doesNotMatch(String(currentEvent.replies[0]), /米游社/)
  assert.doesNotMatch(
    String(currentEvent.replies[0]),
    /白名单|阈值|置信度|召回分数/,
  )
})

test("game sign-in is offered before account help when the model guesses help", async () => {
  const segment = {
    button(...data) {
      return { type: "button", data }
    },
  }
  const fixture = serviceFixture(
    async () => ({
      ok: true,
      route: {
        mode: "command",
        candidateId: "xiaoyao.account_help",
        slots: [],
        confidence: 0.99,
        alternatives: [],
        reply: "",
      },
      responseMeta: { model: "test-model" },
    }),
    {
      segment,
      configMutator(config) {
        config.reply.useButtons = true
      },
    },
  )
  const currentEvent = event({
    msg: "原神怎么签到",
    raw_message: "原神怎么签到",
  })

  assert.equal(await fixture.service.handle(currentEvent), true)
  assert.equal(fixture.calls.dispatch, 0)
  const reply = currentEvent.replies[0]
  assert.match(reply[0], /直接用下面这些命令/)
  assert.match(reply[0], /#原神签到/)
  assert.match(reply[0], /#米游社帮助/)
  assert.deepEqual(
    reply[1].data.map(row => row[0].callback),
    ["#原神签到", "#米游社帮助"],
  )
  assert.deepEqual(
    reply[1].data.map(row => row[0].text),
    ["#原神签到", "#米游社帮助"],
  )
})

test("side-effecting command requires confirmation even at confidence 1", async () => {
  const fixture = serviceFixture(async () => ({
    ok: true,
    route: {
      mode: "command",
      candidateId: "waves.sign",
      slots: [],
      confidence: 1,
      alternatives: [],
      reply: "",
    },
    responseMeta: { model: "test-model" },
  }))
  const currentEvent = event({
    msg: "帮我执行鸣潮签到",
    raw_message: "帮我执行鸣潮签到",
  })

  assert.equal(await fixture.service.handle(currentEvent), true)
  assert.equal(fixture.calls.dispatch, 0)
  assert.match(String(currentEvent.replies[0]), /更改账号或功能状态/)
  assert.match(String(currentEvent.replies[0]), /~签到/)
})

test("a model cannot select a candidate that was not offered", async () => {
  const fixture = serviceFixture(async () => ({
    ok: true,
    route: {
      mode: "command",
      candidateId: "miao.profile_detail",
      slots: [{ name: "character", value: "胡桃" }],
      confidence: 1,
      alternatives: [],
      reply: "",
    },
    responseMeta: { model: "test-model" },
  }))
  const currentEvent = event({ msg: "鸣潮体力还有多少" })

  assert.equal(await fixture.service.handle(currentEvent), true)
  assert.equal(fixture.calls.dispatch, 0)
  assert.match(String(currentEvent.replies[0]), /安全地对应/)
})

test("invalid structured output fails closed", async () => {
  const fixture = serviceFixture(async () => ({
    ok: false,
    error: "invalid JSON",
  }))
  const currentEvent = event()

  assert.equal(await fixture.service.handle(currentEvent), true)
  assert.equal(fixture.calls.dispatch, 0)
  assert.match(String(currentEvent.replies[0]), /暂时不可用/)
})

test("missing API configuration is reported without calling the router", async () => {
  const fixture = serviceFixture(async () => {
    throw new Error("router should not run")
  })
  fixture.configManager.errors = ["尚未设置 api.model"]
  const currentEvent = event()

  assert.equal(await fixture.service.handle(currentEvent), true)
  assert.equal(fixture.calls.router, 0)
  assert.match(String(currentEvent.replies[0]), /尚未配置/)
})

test("clarify mode provides fixed command suggestions", async () => {
  const fixture = serviceFixture(async () => ({
    ok: true,
    route: {
      mode: "clarify",
      candidateId: null,
      slots: [],
      confidence: 0.4,
      alternatives: [],
      reply: "你想看鸣潮体力还是账号卡片？",
    },
    responseMeta: { model: "test-model" },
  }))
  const currentEvent = event()

  assert.equal(await fixture.service.handle(currentEvent), true)
  assert.equal(fixture.calls.dispatch, 0)
  assert.match(String(currentEvent.replies[0]), /鸣潮体力/)
  assert.match(String(currentEvent.replies[0]), /~体力/)
})

test("clarification can render five model command alternatives", async () => {
  const segment = {
    button(...data) {
      return { type: "button", data }
    },
  }
  const fixture = serviceFixture(
    async () => ({
      ok: true,
      route: {
        mode: "clarify",
        candidateId: null,
        slots: [],
        confidence: 0.5,
        alternatives: [
          { candidateId: "miao.genshin_calendar", confidence: 0.9 },
          { candidateId: "genshin.announcements", confidence: 0.8 },
          { candidateId: "genshin.redemption_codes", confidence: 0.7 },
          { candidateId: "genshin.ledger", confidence: 0.6 },
          { candidateId: "miao.profile_list", confidence: 0.5 },
        ],
        reply: "你想使用哪一个原神功能？",
      },
      responseMeta: { model: "test-model" },
    }),
    {
      segment,
      configMutator(config) {
        config.reply.useButtons = true
      },
    },
  )
  const currentEvent = event({
    msg: "原神有哪些功能",
    raw_message: "原神有哪些功能",
  })

  assert.equal(await fixture.service.handle(currentEvent), true)
  const rows = currentEvent.replies[0][1].data
  assert.equal(rows.length, 5)
  assert.equal(new Set(rows.map(row => row[0].callback)).size, 5)
})

test("missing required command slot triggers a follow-up question", async () => {
  const fixture = serviceFixture(async () => ({
    ok: true,
    route: {
      mode: "command",
      candidateId: "waves.profile",
      slots: [],
      confidence: 0.99,
      alternatives: [],
      reply: "",
    },
    responseMeta: { model: "test-model" },
  }))
  const currentEvent = event({
    msg: "我想看鸣潮角色面板",
    raw_message: "我想看鸣潮角色面板",
  })

  assert.equal(await fixture.service.handle(currentEvent), true)
  assert.equal(fixture.calls.dispatch, 0)
  assert.match(String(currentEvent.replies[0]), /缺少参数/)
})

test("runtime plugin absence fails before confirmation or dispatch", async () => {
  const fixture = serviceFixture(async () => ({
    ok: true,
    route: {
      mode: "command",
      candidateId: "waves.sanity",
      slots: [],
      confidence: 0.99,
      alternatives: [],
      reply: "",
    },
    responseMeta: { model: "test-model" },
  }))
  fixture.pluginLoader.priority = []
  const currentEvent = event()

  assert.equal(await fixture.service.handle(currentEvent), true)
  assert.equal(fixture.calls.dispatch, 0)
  assert.match(String(currentEvent.replies[0]), /未检测到 waves 插件/)
})

test("confirmation uses a public QQ callback button when the adapter supports it", async () => {
  const segment = {
    button(...data) {
      return { type: "button", data }
    },
  }
  const fixture = serviceFixture(
    async () => ({
      ok: true,
      route: {
        mode: "command",
        candidateId: "waves.sign",
        slots: [],
        confidence: 1,
        alternatives: [],
        reply: "",
      },
      responseMeta: { model: "test-model" },
    }),
    {
      segment,
      configMutator(config) {
        config.reply.useButtons = true
      },
    },
  )
  const currentEvent = event({
    msg: "帮我执行鸣潮签到",
    raw_message: "帮我执行鸣潮签到",
  })

  assert.equal(await fixture.service.handle(currentEvent), true)
  const reply = currentEvent.replies[0]
  assert.ok(Array.isArray(reply))
  assert.match(reply[0], /~签到/)
  assert.equal(reply[1].type, "button")
  assert.equal(reply[1].data[0][0].callback, "~签到")
  assert.equal(reply[1].data[0][0].text, "确认：~签到")
  assert.equal(Object.hasOwn(reply[1].data[0][0], "permission"), false)
})

test("low-confidence parameterized commands include a directly clickable button", async () => {
  const segment = {
    button(...data) {
      return { type: "button", data }
    },
  }
  const fixture = serviceFixture(
    async () => ({
      ok: true,
      route: {
        mode: "command",
        candidateId: "miao.profile_detail",
        slots: [{ name: "character", value: "遐蝶" }],
        confidence: 0.8,
        alternatives: [],
        reply: "",
      },
      responseMeta: { model: "test-model" },
    }),
    {
      segment,
      configMutator(config) {
        config.reply.useButtons = true
      },
    },
  )
  const currentEvent = event({
    msg: "能给我看下遐蝶的面板吗",
    raw_message: "能给我看下遐蝶的面板吗",
  })

  assert.equal(await fixture.service.handle(currentEvent), true)
  assert.equal(fixture.calls.dispatch, 0)
  const reply = currentEvent.replies[0]
  assert.equal(reply[1].data[0][0].callback, "#星铁遐蝶面板")
})

test("Star Rail guide clarifications offer guide, panel, and atlas buttons", async () => {
  const segment = {
    button(...data) {
      return { type: "button", data }
    },
  }
  const fixture = serviceFixture(
    async () => ({
      ok: true,
      route: {
        mode: "clarify",
        candidateId: null,
        slots: [],
        confidence: 0.4,
        alternatives: [],
        reply: "你是想查看遐蝶的培养攻略吗？",
      },
      responseMeta: { model: "test-model" },
    }),
    {
      segment,
      configMutator(config) {
        config.reply.useButtons = true
      },
    },
  )
  const currentEvent = event({
    msg: "给我一份遐蝶的攻略",
    raw_message: "给我一份遐蝶的攻略",
  })

  assert.equal(await fixture.service.handle(currentEvent), true)
  const reply = currentEvent.replies[0]
  const commands = reply[1].data.map(row => row[0].callback)
  assert.deepEqual(commands, [
    "*遐蝶攻略",
    "#星铁遐蝶面板",
    "#星铁遐蝶图鉴",
  ])
  assert.equal(
    reply[1].data.every(row => !Object.hasOwn(row[0], "permission")),
    true,
  )
})

test("clear QR login intent asks for one-click confirmation", async () => {
  const segment = {
    button(...data) {
      return { type: "button", data }
    },
  }
  const fixture = serviceFixture(
    async () => ({
      ok: true,
      route: {
        mode: "command",
        candidateId: "xiaoyao.qr_login",
        slots: [],
        confidence: 1,
        alternatives: [],
        reply: "",
      },
      responseMeta: { model: "test-model" },
    }),
    {
      segment,
      configMutator(config) {
        config.reply.useButtons = true
      },
    },
  )
  const currentEvent = event({
    msg: "我要执行原神扫码登录",
    raw_message: "我要执行原神扫码登录",
  })

  assert.equal(await fixture.service.handle(currentEvent), true)
  assert.equal(fixture.calls.dispatch, 0)
  const reply = currentEvent.replies[0]
  assert.match(reply[0], /更改账号或功能状态/)
  assert.equal(reply[1].data[0][0].callback, "#扫码登录")
})

test("a dispatcher failure is surfaced without retrying the command", async () => {
  const fixture = serviceFixture(async () => ({
    ok: true,
    route: {
      mode: "command",
      candidateId: "waves.sanity",
      slots: [],
      confidence: 0.99,
      alternatives: [],
      reply: "",
    },
    responseMeta: { model: "test-model" },
  }))
  fixture.dispatcher.result = { ok: false, error: "dispatch failed" }
  const currentEvent = event()

  assert.equal(await fixture.service.handle(currentEvent), true)
  assert.equal(fixture.calls.dispatch, 1)
  assert.match(String(currentEvent.replies[0]), /暂时不可用/)
})
