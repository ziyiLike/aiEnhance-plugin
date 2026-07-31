import test from "node:test"
import assert from "node:assert/strict"
import { CommandCatalog } from "../src/catalog/CommandCatalog.js"
import { DEFAULT_CONFIG } from "../src/config/defaults.js"
import { createCustomCandidate } from "../src/catalog/presets.js"
import { characterRegistry } from "../src/catalog/CharacterRegistry.js"

function catalog() {
  const value = new CommandCatalog({ logger: { warn() {} } })
  value.configure(DEFAULT_CONFIG.commands)
  return value
}

test("catalog retrieves the expected plugin intents from natural Chinese", () => {
  const value = catalog()
  assert.equal(value.search("看看我的鸣潮体力")[0].candidate.id, "waves.sanity")
  assert.equal(value.search("胡桃的面板怎么样")[0].candidate.id, "miao.profile_detail")
  assert.equal(value.search("星铁最近有什么活动")[0].candidate.id, "miao.starrail_calendar")
  assert.equal(value.search("无相之雷是什么怪")[0].candidate.id, "xiaoyao.atlas")
  assert.equal(value.search("深渊怎么配队")[0].candidate.id, "miao.abyss_teams")
  assert.equal(value.search("看看鸣潮签到记录")[0].candidate.id, "waves.sign_records")
  assert.equal(value.search("琉璃袋在哪里")[0].candidate.id, "xiaoyao.map_location")
  assert.equal(value.search("能给我看下遐蝶的面板吗")[0].candidate.id, "miao.profile_detail")
  assert.equal(value.search("给我木偶的攻略")[0].candidate.id, "genshin.guide")
  assert.equal(value.search("给我一份遐蝶的攻略")[0].candidate.id, "starrail.guide")
  assert.equal(value.search("执行原神扫码登录")[0].candidate.id, "xiaoyao.qr_login")
})

test("character presets identify all four games before model routing", () => {
  assert.deepEqual(characterRegistry.analyze("胡桃面板").inferredGames, ["genshin"])
  assert.deepEqual(characterRegistry.analyze("今汐攻略").inferredGames, ["waves"])
  assert.deepEqual(characterRegistry.analyze("遐蝶面板").inferredGames, ["starrail"])
  assert.deepEqual(characterRegistry.analyze("星见雅面板").inferredGames, ["zzz"])
  assert.deepEqual(characterRegistry.analyze("木偶攻略").characters[0], {
    game: "genshin",
    gameLabel: "原神",
    character: "桑多涅",
    matched: "木偶",
  })

  const ambiguous = characterRegistry.analyze("露西面板")
  assert.equal(ambiguous.ambiguous, true)
  assert.deepEqual(new Set(ambiguous.inferredGames), new Set(["waves", "zzz"]))
})

test("character game conflicts are removed from the candidate set", () => {
  const value = catalog()
  const starrailGuide = value.search("给我一份遐蝶的攻略")
  assert.equal(
    starrailGuide.some(result => result.candidate.id === "waves.guide"),
    false,
  )
  assert.equal(
    starrailGuide.some(result => result.candidate.id === "starrail.guide"),
    true,
  )

  const zzzProfile = value.search("给我看看星见雅面板")
  for (const id of ["miao.profile_detail", "waves.profile", "xiaoyao.atlas"]) {
    assert.equal(zzzProfile.some(result => result.candidate.id === id), false)
  }
})

test("catalog builds parameterized commands locally", () => {
  const value = catalog()
  const built = value.buildCommand("miao.profile_detail", [
    { name: "character", value: "胡桃" },
    { name: "view", value: "圣遗物" },
  ])
  assert.equal(built.ok, true)
  assert.equal(built.command, "#胡桃圣遗物")

  const starrail = value.buildCommand("miao.profile_detail", [
    { name: "character", value: "瑕蝶" },
  ])
  assert.equal(starrail.ok, true)
  assert.equal(starrail.command, "#星铁遐蝶面板")

  const starrailAlias = value.buildCommand(
    "miao.profile_detail",
    [{ name: "character", value: "鸭鸭" }],
    { context: value.analyze("星铁鸭鸭面板") },
  )
  assert.equal(starrailAlias.command, "#星铁布洛妮娅面板")

  const waves = value.buildCommand("waves.profile", [
    { name: "character", value: "今夕" },
  ])
  assert.equal(waves.command, "~今汐面板")

  const genshinGuide = value.buildCommand("genshin.guide", [
    { name: "character", value: "木偶" },
  ])
  assert.equal(genshinGuide.command, "#桑多涅攻略")

  const starrailGuide = value.buildCommand("starrail.guide", [
    { name: "character", value: "瑕蝶" },
  ])
  assert.equal(starrailGuide.command, "*遐蝶攻略")

  const gacha = value.buildCommand("miao.gacha_summary", [
    { name: "game", value: "星铁" },
    { name: "view", value: "统计" },
  ])
  assert.equal(gacha.command, "#星铁喵喵抽卡统计")

  const location = value.buildCommand("xiaoyao.map_location", [
    { name: "topic", value: "琉璃袋" },
  ])
  assert.equal(location.command, "#琉璃袋在哪里")

  const starrailAtlas = value.buildCommand("xiaoyao.atlas", [
    { name: "topic", value: "托帕&账账" },
  ])
  assert.equal(starrailAtlas.command, "#星铁托帕&账账图鉴")
})

test("catalog rejects missing, unknown, and command-injection-like slots", () => {
  const value = catalog()
  assert.equal(value.buildCommand("waves.profile", []).ok, false)
  assert.equal(
    value.buildCommand("waves.profile", [
      { name: "character", value: "今汐" },
      { name: "unexpected", value: "value" },
    ]).ok,
    false,
  )
  assert.equal(
    value.buildCommand("miao.profile_detail", [
      { name: "character", value: "删除全部面板" },
    ]).ok,
    false,
  )
  assert.equal(
    value.buildCommand("waves.guide", [
      { name: "character", value: "遐蝶" },
    ]).ok,
    false,
  )
  assert.equal(
    value.buildCommand("genshin.guide", [
      { name: "character", value: "遐蝶" },
    ]).ok,
    false,
  )
  assert.equal(
    value.buildCommand("starrail.guide", [
      { name: "character", value: "木偶" },
    ]).ok,
    false,
  )
  assert.equal(
    value.buildCommand("miao.profile_detail", [
      { name: "character", value: "今汐" },
    ]).ok,
    false,
  )
  assert.equal(
    value.buildCommand("xiaoyao.atlas", [
      { name: "topic", value: "胡桃\n#喵喵强制更新" },
    ]).ok,
    false,
  )
})

test("runtime validation checks the target plugin, not an unrelated broad rule", () => {
  const value = catalog()
  const miao = value.find("miao.profile_detail")
  const loader = {
    priority: [
      {
        key: "xiaoyao-cvs-plugin/index.js",
        name: "xiaoyao-cvs-plugin",
        plugin: { rule: [{ reg: /.+/ }] },
      },
      {
        key: "miao-plugin/index.js",
        name: "喵喵:角色面板",
        plugin: { rule: [{ reg: /^#[^#]+面板$/ }] },
      },
    ],
  }
  assert.equal(value.validateRuntime(miao, "#胡桃面板", loader).ok, true)
  assert.equal(value.validateRuntime(miao, "#胡桃图鉴", loader).ok, false)
})

test("guide runtime validation targets the actual strategy handlers", () => {
  const value = catalog()
  const loader = {
    priority: [
      {
        key: "genshin/index.js",
        name: "米游社攻略",
        plugin: { rule: [{ reg: /^#?(更新)?\S+攻略([1-7])?$/ }] },
      },
      {
        key: "StarRail-plugin/index.js",
        name: "米游社星铁攻略",
        plugin: { rule: [{ reg: /^\*(更新)?\S+攻略(\d+|all)?$/ }] },
      },
    ],
  }

  assert.equal(
    value.validateRuntime(value.find("genshin.guide"), "#桑多涅攻略", loader).ok,
    true,
  )
  assert.equal(
    value.validateRuntime(value.find("starrail.guide"), "*遐蝶攻略", loader).ok,
    true,
  )
  assert.equal(
    value.validateRuntime(value.find("genshin.guide"), "*遐蝶攻略", loader).ok,
    false,
  )
})

test("xiaoyao compatibility accepts its internal dispatcher after plugin presence check", () => {
  const value = catalog()
  const candidate = value.find("xiaoyao.atlas")
  const loader = {
    priority: [
      {
        key: "xiaoyao-cvs-plugin/index.js",
        name: "xiaoyao-cvs-plugin",
        plugin: { rule: [{ reg: /.+/ }] },
      },
    ],
  }
  assert.equal(value.validateRuntime(candidate, "#胡桃图鉴", loader).ok, true)
})

test("runtime validation respects Yunzai group-level plugin disable settings", () => {
  const value = catalog()
  const candidate = value.find("waves.sanity")
  const originalEvent = { group_id: "original" }
  const loader = {
    priority: [
      {
        key: "waves-plugin/index.js",
        name: "鸣潮-日常数据",
        plugin: {
          e: originalEvent,
          rule: [{ reg: /^~体力$/ }],
        },
      },
    ],
    checkDisable(plugin) {
      return plugin.e.group_id !== "group"
    },
  }
  const result = value.validateRuntime(
    candidate,
    "~体力",
    loader,
    { self_id: "bot", group_id: "group" },
  )
  assert.equal(result.ok, false)
  assert.match(result.reason, /当前群已禁用/)
  assert.equal(loader.priority[0].plugin.e, originalEvent)
})

test("custom candidates preserve explicit safety risks and reject unknown ones", () => {
  const admin = createCustomCandidate({
    id: "custom.admin",
    plugin: "custom-plugin",
    description: "管理命令",
    command: "#管理操作",
    risk: "admin",
  })
  assert.equal(admin.risk, "admin")
  assert.equal(admin.autoExecute, false)

  assert.equal(
    createCustomCandidate({
      id: "custom.typo",
      plugin: "custom-plugin",
      description: "风险拼写错误",
      command: "#测试",
      risk: "raed",
    }),
    null,
  )
})
