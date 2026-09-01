import test from "node:test"
import assert from "node:assert/strict"
import { RequestGate } from "../src/runtime/RequestGate.js"
import { MemoryStore, conversationKey } from "../src/runtime/MemoryStore.js"
import {
  REPLAY_SYMBOL,
  SafeDispatcher,
  createReplayEvent,
  isReplayedEvent,
} from "../src/runtime/SafeDispatcher.js"
import { createLogger } from "../src/utils/logger.js"

test("plugin logger adds its prefix exactly once", () => {
  const messages = []
  const logger = createLogger({
    logger: { warn(message) { messages.push(message) } },
  })

  logger.warn("普通警告")
  logger.warn("[aiEnhance-plugin] 已带前缀")

  assert.deepEqual(messages, [
    "[aiEnhance-plugin] 普通警告",
    "[aiEnhance-plugin] 已带前缀",
  ])
})

test("RequestGate enforces in-flight, per-window, and global limits", () => {
  let now = 1_000
  const gate = new RequestGate({ now: () => now })
  const limits = {
    perUserRequests: 1,
    perUserWindowSeconds: 60,
    globalConcurrency: 1,
  }

  const first = gate.acquire("a", limits)
  assert.equal(first.ok, true)
  assert.equal(gate.acquire("a", limits).reason, "user_busy")
  assert.equal(gate.acquire("b", limits).reason, "global_busy")
  first.release()
  assert.equal(gate.acquire("a", limits).reason, "rate_limited")

  now += 61_000
  const afterWindow = gate.acquire("a", limits)
  assert.equal(afterWindow.ok, true)
  afterWindow.release()
})

test("RequestGate prunes expired one-time user buckets", () => {
  let now = 1_000
  const gate = new RequestGate({ now: () => now })
  const limits = {
    perUserRequests: 2,
    perUserWindowSeconds: 1,
    globalConcurrency: 2,
  }

  const old = gate.acquire("old-user", limits)
  old.release()
  assert.equal(gate.requests.has("old-user"), true)

  now += 2_000
  gate.acquireCount = 99
  const current = gate.acquire("current-user", limits)
  assert.equal(gate.requests.has("old-user"), false)
  current.release()
})

test("MemoryStore isolates group conversations and trims history", async () => {
  const store = new MemoryStore()
  const config = {
    enabled: true,
    ttlSeconds: 900,
    maxTurns: 1,
    maxMessageChars: 5,
  }
  const first = {
    self_id: "bot",
    group_id: "group-a",
    user_id: "user",
    isGroup: true,
  }
  const second = { ...first, group_id: "group-b" }

  await store.append(first, "123456789", "abcdefghi", config)
  assert.deepEqual(await store.get(first, config), [
    { role: "user", content: "12345" },
    { role: "assistant", content: "abcde" },
  ])
  assert.deepEqual(await store.get(second, config), [])
  assert.notEqual(conversationKey(first), conversationKey(second))

  await store.append(first, "second-user", "second-assistant", config)
  assert.deepEqual(await store.get(first, config), [
    { role: "user", content: "secon" },
    { role: "assistant", content: "secon" },
  ])

  await store.clear(first)
  assert.deepEqual(await store.get(first, config), [])
})

test("MemoryStore prunes expired fallback conversations", () => {
  const store = new MemoryStore()
  store.fallback.set("expired", {
    messages: [],
    expiresAt: Date.now() - 1,
  })
  store.fallback.set("active", {
    messages: [],
    expiresAt: Date.now() + 10_000,
  })

  store.pruneFallback()
  assert.equal(store.fallback.has("expired"), false)
  assert.equal(store.fallback.has("active"), true)
})

test("SafeDispatcher creates a guarded replay and preserves authorization identity", async () => {
  let received
  const pluginLoader = {
    async deal(event) {
      received = event
    },
  }
  const sent = []
  const event = {
    bot: { id: "bot" },
    self_id: "bot",
    message_type: "group",
    sub_type: "normal",
    message_id: "message",
    user_id: "user",
    sender: { user_id: "user", nickname: "name" },
    group_id: "group",
    group: {
      sendMsg(message) {
        sent.push(message)
      },
    },
    member: { is_admin: false },
    isGroup: true,
    isMaster: false,
    reply() {},
  }

  const dispatcher = new SafeDispatcher({ pluginLoader, logger: { error() {} } })
  const result = await dispatcher.dispatch(event, {
    command: "~体力",
    candidateId: "waves.sanity",
  })

  assert.equal(result.ok, true)
  assert.equal(received.msg, "~体力")
  assert.equal(received.raw_message, "~体力")
  assert.equal(received.message, null)
  assert.equal(received.user_id, "user")
  assert.equal(received.group_id, "group")
  assert.equal(received.isMaster, false)
  assert.equal(received.aiEnhanceCandidateId, "waves.sanity")
  assert.equal(isReplayedEvent(received), true)
  assert.equal(received[REPLAY_SYMBOL], true)
})

test("createReplayEvent does not mutate the original event", () => {
  const event = {
    self_id: "bot",
    user_id: "user",
    msg: "自然语言",
    raw_message: "自然语言",
    reply() {},
  }
  const replay = createReplayEvent(event, "#日历", "miao.genshin_calendar")
  assert.equal(event.msg, "自然语言")
  assert.equal(replay.msg, "#日历")
  assert.equal(isReplayedEvent(event), false)
  assert.equal(isReplayedEvent(replay), true)
})

test("SafeDispatcher can capture plugin replies without sending them early", async () => {
  const sent = []
  const event = {
    self_id: "bot",
    user_id: "user",
    group_id: "group",
    message_type: "group",
    isGroup: true,
    group: {
      sendMsg(message) {
        sent.push(message)
      },
    },
    reply(message) {
      sent.push(message)
    },
  }
  const pluginLoader = {
    async deal(replay) {
      await replay.reply("准备攻略")
      await replay.group.sendMsg({
        type: "image",
        file: "/yunzai/guide.jpg",
      })
    },
  }
  const dispatcher = new SafeDispatcher({
    pluginLoader,
    logger: { error() {} },
  })

  const result = await dispatcher.capture(
    event,
    {
      command: "#纳西妲攻略",
      candidateId: "genshin.guide",
    },
    { timeoutMs: 1_000 },
  )

  assert.equal(result.ok, true)
  assert.deepEqual(sent, [])
  assert.deepEqual(
    result.replies.map(item => item.message),
    [
      "准备攻略",
      {
        type: "image",
        file: "/yunzai/guide.jpg",
      },
    ],
  )
  assert.equal(isReplayedEvent(result.replay), true)
})
