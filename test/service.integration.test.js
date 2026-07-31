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
} from "../src/runtime/AiEnhanceService.js"
import { REPLAY_SYMBOL } from "../src/runtime/SafeDispatcher.js"

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

function serviceFixture(routeFactory, { configMutator, segment } = {}) {
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
    pluginLoader,
    segment,
    logger,
  })

  return { service, calls, config, configManager, pluginLoader, dispatcher }
}

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

test("lower confidence command asks for confirmation instead of dispatching", async () => {
  const fixture = serviceFixture(async () => ({
    ok: true,
    route: {
      mode: "command",
      candidateId: "waves.sanity",
      slots: [],
      confidence: 0.8,
      alternatives: [],
      reply: "",
    },
    responseMeta: { model: "test-model" },
  }))
  const currentEvent = event()

  assert.equal(await fixture.service.handle(currentEvent), true)
  assert.equal(fixture.calls.dispatch, 0)
  assert.match(String(currentEvent.replies[0]), /~体力/)
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
  assert.match(String(currentEvent.replies[0]), /修改状态/)
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

test("confirmation uses a QQ callback button when the adapter supports it", async () => {
  const segment = {
    button(rows) {
      return { type: "button", rows }
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
  assert.equal(reply[1].type, "button")
  assert.equal(reply[1].rows[0][0].callback, "~签到")
  assert.equal(reply[1].rows[0][0].permission, "user")
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
