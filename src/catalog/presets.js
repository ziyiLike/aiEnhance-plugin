import {
  characterRegistry,
  resolveWhitelistedCharacter,
} from "./CharacterRegistry.js"

const SAFE_ENTITY_PATTERN = /^[A-Za-z0-9\u3400-\u9fff·・_\-\s]{1,24}$/
const FORBIDDEN_ENTITY_WORDS =
  /(删除|清除|移除|更新|重载|设置|上传|添加|开启|关闭|登录|绑定|解绑|强制|重启|token|cookie|stoken|api.?key)/i
const GAME_UID_PATTERN = /^(?:(?:1[0-9]|[1-9])[0-9]{8}|[1-9][0-9]{7})$/

function cleanEntity(value) {
  const text = String(value || "").trim().replace(/\s+/g, " ")
  if (!SAFE_ENTITY_PATTERN.test(text) || FORBIDDEN_ENTITY_WORDS.test(text)) {
    throw new Error("参数包含不安全或不支持的内容")
  }
  return text
}

function cleanEnum(value, allowedValues, fallback = "") {
  const text = String(value || "").trim()
  if (!text && fallback) return fallback
  if (!allowedValues.includes(text)) throw new Error(`参数必须是：${allowedValues.join("、")}`)
  return text
}

function cleanGameUid(value) {
  const text = String(value || "").trim()
  if (!text) return ""
  if (!GAME_UID_PATTERN.test(text)) {
    throw new Error("UID 格式不正确，请只提供有效的游戏 UID")
  }
  return text
}

function cleanPatternValue(value, pattern, errorMessage) {
  const text = String(value || "").trim()
  if (!pattern.test(text)) throw new Error(errorMessage)
  return text
}

function cleanCommandArgument(value, errorMessage = "命令参数格式不正确", maxLength = 120) {
  const text = String(value || "").trim()
  if (!text || text.length > maxLength || /[\r\n]/.test(text)) {
    throw new Error(errorMessage)
  }
  return text
}

function cleanGachaPayload(value) {
  const text = String(value || "").trim()
  if (
    !text ||
    text.length > 6000 ||
    (!/^https?:\/\/\S+$/i.test(text) && !/^\{[\s\S]*\}$/.test(text))
  ) {
    throw new Error("抽卡请求体必须是完整的 HTTP(S) 链接或 JSON，且不能超过 6000 字符")
  }
  return text
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function gamesFromContext(context, supportedGames) {
  const hinted =
    context?.explicitGames?.length === 1
      ? context.explicitGames[0]
      : context?.inferredGames?.length === 1
        ? context.inferredGames[0]
        : ""
  return hinted && supportedGames.includes(hinted) ? [hinted] : supportedGames
}

function fixedCommand({
  id,
  plugin,
  description,
  command,
  intentExamples,
  keywords,
  risk = "read",
  autoExecute = risk === "read",
  runtimeAliases,
  runtimeRuleOptional = false,
  games,
}) {
  return {
    id,
    plugin,
    description,
    intentExamples,
    keywords,
    risk,
    autoExecute,
    runtimeAliases,
    runtimeRuleOptional,
    games,
    slots: [],
    commandExamples: [command],
    build: () => command,
    validateCommand: new RegExp(`^${escapeRegExp(command)}$`),
  }
}

function fixedCommandGroup(defaults, entries) {
  return entries.map(entry => fixedCommand({ ...defaults, ...entry }))
}

function commandFamily({
  id,
  plugin,
  description,
  intentExamples,
  keywords,
  commandExamples,
  build,
  validateCommand,
  slots = [],
  risk = "read",
  autoExecute = risk === "read",
  runtimeAliases,
  runtimeRuleOptional = false,
  games,
  characterSlot,
  characterTopicSlot,
  maxCommandLength = 200,
  allowNewlines = false,
}) {
  return {
    id,
    plugin,
    description,
    intentExamples,
    keywords,
    risk,
    autoExecute,
    runtimeAliases,
    runtimeRuleOptional,
    games,
    characterSlot,
    characterTopicSlot,
    maxCommandLength,
    allowNewlines,
    slots,
    commandExamples,
    build,
    validateCommand,
  }
}

function characterGuide({
  id,
  plugin,
  description,
  game,
  prefix,
  intentExamples,
  keywords,
  commandExamples,
  runtimeAliases,
}) {
  return {
    id,
    plugin,
    description,
    intentExamples,
    keywords: [...new Set([...keywords, "查看", "看看", "给我"])],
    risk: "read",
    autoExecute: true,
    runtimeAliases,
    games: [game],
    characterSlot: "character",
    slots: [
      {
        name: "character",
        required: true,
        description: `${GAME_LABELS_FOR_SLOTS[game]}角色名称或常用别名`,
      },
    ],
    commandExamples,
    build: slots => {
      const character = resolveWhitelistedCharacter(slots.character, [game])
      return `${prefix}${character.character}攻略`
    },
    validateCommand: new RegExp(
      `^${escapeRegExp(prefix)}[^#*~\\n]{1,24}攻略$`,
    ),
  }
}

const GAME_LABELS_FOR_SLOTS = {
  genshin: "原神",
  starrail: "星铁",
  zzz: "绝区零",
}

function gameUidBinding({
  id,
  game,
  prefix,
  intentExamples,
  runtimeAliases = ["Yunzai-genshin", "genshin/", "用户绑定"],
}) {
  const gameLabel = GAME_LABELS_FOR_SLOTS[game]
  return {
    id,
    plugin: "genshin",
    description: `绑定${gameLabel}游戏 UID`,
    intentExamples,
    keywords: [gameLabel, "绑定", "UID", "游戏账号"],
    risk: "write",
    autoExecute: false,
    runtimeAliases,
    // 不带 UID 的交互式命令由 Yunzai-genshin 的 accept() 处理，
    // 不会出现在普通 rule 列表中，因此这里只校验插件存在和本地命令模板。
    runtimeRuleOptional: true,
    games: [game],
    slots: [
      {
        name: "uid",
        required: false,
        description: "纯数字游戏 UID；用户没有提供时留空以进入交互式绑定",
      },
    ],
    commandExamples: [`#${prefix}绑定uid`, `#${prefix}绑定123456789`],
    build: slots => `#${prefix}绑定${cleanGameUid(slots.uid) || "uid"}`,
    validateCommand: new RegExp(
      `^#${escapeRegExp(prefix)}绑定(?:uid|(?:(?:1[0-9]|[1-9])[0-9]{8}|[1-9][0-9]{7}))$`,
      "i",
    ),
  }
}

function gameUidLookup({ id, game, prefix, intentExamples }) {
  const gameLabel = GAME_LABELS_FOR_SLOTS[game]
  return fixedCommand({
    id,
    plugin: "genshin",
    description: `查看当前绑定的${gameLabel}游戏 UID`,
    command: `#${prefix}uid`,
    intentExamples,
    keywords: [gameLabel, "UID", "查看绑定", "游戏账号"],
    runtimeAliases: ["Yunzai-genshin", "genshin/", "用户绑定"],
    games: [game],
  })
}

const MIAO_RUNTIME_ALIASES = ["miao-plugin", "喵喵"]
const GENSHIN_RUNTIME_ALIASES = ["Yunzai-genshin", "genshin/"]
const STARRAIL_RUNTIME_ALIASES = [
  "StarRail-plugin",
  "starrail-plugin",
  "星铁plugin",
]
const WAVES_RUNTIME_ALIASES = ["waves-plugin", "鸣潮-"]
const XIAOYAO_RUNTIME_ALIASES = ["xiaoyao-cvs-plugin", "图鉴插件"]

function wavesSchedule({ id, label, aliases = [label] }) {
  const matcher = aliases.map(escapeRegExp).join("|")
  return commandFamily({
    id,
    plugin: "waves",
    description: `查看鸣潮${label}当期、上期、下期、指定期数或期数列表`,
    intentExamples: [`看看上期${label}`, `查询下期${label}`, `${label}列表`, `第 3 期${label}`],
    keywords: ["鸣潮", label, ...aliases, "当期", "上期", "下期", "期数", "列表"],
    runtimeAliases: WAVES_RUNTIME_ALIASES,
    games: ["waves"],
    slots: [
      {
        name: "period",
        required: false,
        description: "当期、上期、下期、列表或数字期数；未说明时当期",
      },
    ],
    commandExamples: [`~当期${label}`, `~上期${label}`, `~${label}列表`, `~3期${label}`],
    build: slots => {
      const period = slots.period
        ? cleanPatternValue(slots.period, /^(?:当期|当前|本期|上期|下期|列表|\d{1,3}期?)$/, "期数格式不正确")
        : "当期"
      if (period === "列表") return `~${label}列表`
      return `~${period}${label}`
    },
    validateCommand: new RegExp(`^~(?:(?:当期|当前|本期|上期|下期|\\d{1,3}期?)(?:${matcher})|(?:${matcher})列表)$`),
  })
}

function wavesRanking({ id, label }) {
  return commandFamily({
    id,
    plugin: "waves",
    description: `查看鸣潮${label}群、总榜或 Bot 排名`,
    intentExamples: [`看看${label}群排名`, `上期${label}总排行榜`, `${label} Bot 排名`],
    keywords: ["鸣潮", label, "上期", "群", "总榜", "Bot", "排行", "排名", "排行榜"],
    runtimeAliases: WAVES_RUNTIME_ALIASES,
    games: ["waves"],
    slots: [
      { name: "period", required: false, description: "本期或上期", allowedValues: ["本期", "上期"] },
      { name: "scope", required: false, description: "群、总榜或 Bot；未说明时个人群榜", allowedValues: ["群", "总", "Bot"] },
      { name: "page", required: false, description: "可选页码 1 到 5", allowedValues: ["1", "2", "3", "4", "5"] },
    ],
    commandExamples: [`~${label}群排名`, `~上期${label}总排行2`, `~${label}bot排行榜`],
    build: slots => {
      const period = slots.period === "上期" ? "上期" : ""
      const scope = slots.scope ? cleanEnum(slots.scope, ["群", "总", "Bot"]) : "群"
      const normalizedScope = scope === "Bot" ? "bot" : scope
      return `~${period}${label}${normalizedScope}排名${slots.page ? cleanEnum(slots.page, ["1", "2", "3", "4", "5"]) : ""}`
    },
    validateCommand: new RegExp(`^~(?:上期)?${escapeRegExp(label)}(?:群|总|bot|BOT)(?:排行|排行榜|排名)[1-5]?$`),
  })
}

function wavesLookup({ id, label, queryWord, listWord = `${label}列表` }) {
  return commandFamily({
    id,
    plugin: "waves",
    description: `查询鸣潮${label}资料或查看${label}列表`,
    intentExamples: [`查询${label}资料`, `搜索一个${label}`, `看看${label}列表`],
    keywords: ["鸣潮", label, "查询", "搜索", "列表", "资料"],
    runtimeAliases: WAVES_RUNTIME_ALIASES,
    games: ["waves"],
    slots: [{ name: "topic", required: false, description: `要查询的${label}名称；留空查看列表` }],
    commandExamples: [`~${queryWord}示例`, `~${listWord}`],
    build: slots => slots.topic ? `~${queryWord}${cleanEntity(slots.topic)}` : `~${listWord}`,
    validateCommand: new RegExp(`^~(?:${escapeRegExp(queryWord)}[^~#\\r\\n]{1,24}|${escapeRegExp(listWord)})$`),
  })
}

const miao = [
  fixedCommand({
    id: "miao.help",
    plugin: "miao",
    description: "查看喵喵插件帮助和命令菜单",
    command: "#喵喵帮助",
    intentExamples: ["喵喵插件怎么用", "看看原神功能菜单", "给我喵喵帮助"],
    keywords: ["喵喵", "原神", "帮助", "菜单", "命令", "功能"],
    runtimeAliases: ["miao-plugin", "喵喵"],
  }),
  ...fixedCommandGroup(
    {
      plugin: "miao",
      runtimeAliases: MIAO_RUNTIME_ALIASES,
    },
    [
      {
        id: "miao.version",
        description: "查看喵喵插件版本和更新说明",
        command: "#喵喵版本",
        intentExamples: ["喵喵插件是什么版本", "看看喵喵版本更新"],
        keywords: ["喵喵", "版本", "更新说明"],
      },
      {
        id: "miao.panel_help",
        description: "查看角色面板获取、更新和替换帮助",
        command: "#面板帮助",
        intentExamples: ["面板怎么用", "角色面板怎么更新", "看看面板帮助"],
        keywords: ["原神", "星铁", "面板", "帮助", "更新", "替换"],
        games: ["genshin", "starrail"],
      },
      {
        id: "miao.update_log",
        description: "查看喵喵插件最近的更新日志",
        command: "#喵喵更新日志",
        intentExamples: ["看看喵喵最近更新了什么", "喵喵更新日志"],
        keywords: ["喵喵", "更新日志", "改动", "版本记录"],
      },
      {
        id: "miao.wiki_help",
        description: "查看喵喵角色资料查询入口",
        command: "#喵喵WIKI",
        intentExamples: ["喵喵角色资料怎么查", "打开喵喵 WIKI"],
        keywords: ["喵喵", "WIKI", "角色资料", "图鉴"],
      },
      {
        id: "miao.character_card",
        description: "查看喵喵角色卡片",
        command: "#喵喵角色卡片",
        intentExamples: ["看看我的喵喵角色卡片", "随机角色卡片"],
        keywords: ["喵喵", "角色", "卡片", "展示"],
        games: ["genshin"],
      },
      {
        id: "miao.original_image",
        description: "获取所引用角色卡片或面板的原图",
        command: "#原图",
        intentExamples: ["给我这张角色卡的原图", "获取刚才面板的原图"],
        keywords: ["原图", "图片", "角色卡", "面板图"],
        runtimeAliases: [...MIAO_RUNTIME_ALIASES, ...STARRAIL_RUNTIME_ALIASES],
        games: ["genshin", "starrail"],
      },
      {
        id: "miao.alias_help",
        description: "查看喵喵自定义角色别名说明",
        command: "#喵喵别名帮助",
        intentExamples: ["喵喵别名怎么设置", "看看自定义别名帮助"],
        keywords: ["喵喵", "别名", "昵称", "帮助"],
        games: ["genshin", "starrail"],
      },
      {
        id: "miao.talent_stats",
        description: "查看账号角色天赋或技能练度统计",
        command: "#天赋统计",
        intentExamples: ["统计一下我的角色天赋", "看看技能练度"],
        keywords: ["原神", "角色", "天赋", "技能", "统计", "练度"],
        games: ["genshin"],
      },
      {
        id: "miao.avatar_list",
        description: "查看米游社账号中的角色列表",
        command: "#喵喵角色",
        intentExamples: ["看看我的喵喵角色列表", "我有哪些原神角色"],
        keywords: ["原神", "喵喵", "角色", "列表", "账号"],
        games: ["genshin"],
      },
      {
        id: "miao.theater_card_collection",
        description: "查看幻想真境剧诗月谕圣牌收藏数据",
        command: "#幻想真境剧诗圣牌收藏",
        intentExamples: ["看看我的月谕圣牌收藏", "剧诗卡牌收集情况"],
        keywords: ["原神", "剧诗", "幻想真境剧诗", "月谕圣牌", "卡牌", "收藏"],
        games: ["genshin"],
      },
    ],
  ),
  {
    id: "miao.character_wiki",
    plugin: "miao",
    description: "查询原神或星铁角色的天赋、技能、行迹、命座、星魂、资料、图鉴或图片",
    intentExamples: [
      "看看纳西妲天赋",
      "查询胡桃命座",
      "看看黄泉星魂",
      "给我芙宁娜的角色资料",
    ],
    keywords: ["原神", "星铁", "角色", "天赋", "技能", "行迹", "命座", "星魂", "资料", "图鉴", "照片", "图片"],
    risk: "read",
    autoExecute: true,
    runtimeAliases: MIAO_RUNTIME_ALIASES,
    runtimeRuleOptional: true,
    games: ["genshin", "starrail"],
    characterSlot: "character",
    slots: [
      {
        name: "character",
        required: true,
        description: "原神或星铁角色名称或常用别名",
      },
      {
        name: "view",
        required: false,
        description: "要查看的角色资料类型；没有明确说明时使用资料",
        allowedValues: ["天赋", "技能", "行迹", "命座", "命之座", "星魂", "资料", "图鉴", "照片", "写真", "图片", "图像"],
      },
    ],
    commandExamples: ["#纳西妲天赋", "#胡桃命座", "#星铁黄泉星魂"],
    build: (slots, { context } = {}) => {
      const character = resolveWhitelistedCharacter(
        slots.character,
        gamesFromContext(context, ["genshin", "starrail"]),
      )
      const allowedViews = ["天赋", "技能", "行迹", "命座", "命之座", "星魂", "资料", "图鉴", "照片", "写真", "图片", "图像"]
      const view = slots.view
        ? cleanEnum(slots.view, allowedViews)
        : character.game === "starrail"
          ? "天赋"
          : "资料"
      const gamePrefix = character.game === "starrail" ? "星铁" : ""
      return `#${gamePrefix}${character.character}${view}`
    },
    validateCommand: /^#(星铁)?[^#\n]{1,24}(天赋|技能|行迹|命座|命之座|星魂|资料|图鉴|照片|写真|图片|图像)$/,
  },
  {
    id: "miao.alias_list",
    plugin: "miao",
    description: "查看喵喵自定义角色别名列表",
    intentExamples: ["看看喵喵别名列表", "有哪些星铁自定义别名"],
    keywords: ["喵喵", "原神", "星铁", "别名", "昵称", "列表"],
    risk: "read",
    autoExecute: true,
    runtimeAliases: MIAO_RUNTIME_ALIASES,
    games: ["genshin", "starrail"],
    slots: [
      {
        name: "game",
        required: false,
        description: "游戏；没有明确说明时查看全部",
        allowedValues: ["原神", "星铁"],
      },
    ],
    commandExamples: ["#喵喵别名列表", "#喵喵别名原神列表", "#喵喵别名星铁列表"],
    build: slots => {
      const game = slots.game ? cleanEnum(slots.game, ["原神", "星铁"]) : ""
      return `#喵喵别名${game}列表`
    },
    validateCommand: /^#喵喵别名(原神|星铁)?列表$/,
  },
  {
    id: "miao.alias_set",
    plugin: "miao",
    description: "为原神或星铁角色添加一个喵喵自定义别名",
    intentExamples: ["把草神设成纳西妲的别名", "给黄泉添加别名泉姐"],
    keywords: ["喵喵", "原神", "星铁", "添加", "设置", "别名", "昵称"],
    risk: "write",
    autoExecute: false,
    runtimeAliases: MIAO_RUNTIME_ALIASES,
    games: ["genshin", "starrail"],
    characterSlot: "character",
    slots: [
      {
        name: "character",
        required: true,
        description: "要添加别名的原神或星铁角色",
      },
      {
        name: "alias",
        required: true,
        description: "要添加的单个别名",
      },
    ],
    commandExamples: ["#喵喵别名原神设置 纳西妲 草神", "#喵喵别名星铁设置 黄泉 泉姐"],
    build: (slots, { context } = {}) => {
      const character = resolveWhitelistedCharacter(
        slots.character,
        gamesFromContext(context, ["genshin", "starrail"]),
      )
      const game = character.game === "starrail" ? "星铁" : "原神"
      return `#喵喵别名${game}设置 ${character.character} ${cleanEntity(slots.alias)}`
    },
    validateCommand: /^#喵喵别名(原神|星铁)设置\s+[^\s#]{1,24}\s+[^\s#]{1,24}$/,
  },
  {
    id: "miao.alias_delete",
    plugin: "miao",
    description: "删除一个喵喵自定义角色别名",
    intentExamples: ["删除喵喵里的草神别名", "删掉星铁别名泉姐"],
    keywords: ["喵喵", "原神", "星铁", "删除", "别名", "昵称"],
    risk: "write",
    autoExecute: false,
    runtimeAliases: MIAO_RUNTIME_ALIASES,
    games: ["genshin", "starrail"],
    slots: [
      {
        name: "game",
        required: false,
        description: "别名所属游戏；不确定时留空",
        allowedValues: ["原神", "星铁"],
      },
      {
        name: "alias",
        required: true,
        description: "要删除的单个自定义别名",
      },
    ],
    commandExamples: ["#喵喵别名删除 草神", "#喵喵别名星铁删除 泉姐"],
    build: slots => {
      const game = slots.game ? cleanEnum(slots.game, ["原神", "星铁"]) : ""
      return `#喵喵别名${game}删除 ${cleanEntity(slots.alias)}`
    },
    validateCommand: /^#喵喵别名(原神|星铁)?删除\s+[^\s#]{1,24}$/,
  },
  {
    id: "miao.relationship_card",
    plugin: "miao",
    description: "查看喵喵中设置的老婆、老公、女友、男友、女儿或儿子角色",
    intentExamples: ["看看我的老婆", "我的老公是谁", "查看女儿列表"],
    keywords: ["原神", "老婆", "老公", "女友", "男友", "女儿", "儿子", "角色卡"],
    risk: "read",
    autoExecute: true,
    runtimeAliases: MIAO_RUNTIME_ALIASES,
    games: ["genshin"],
    slots: [
      {
        name: "relation",
        required: true,
        description: "关系称呼",
        allowedValues: ["老婆", "老公", "女友", "男友", "女儿", "儿子"],
      },
      {
        name: "view",
        required: false,
        description: "查看卡片、图片还是列表；没有明确说明时使用卡片",
        allowedValues: ["卡片", "图片", "列表"],
      },
    ],
    commandExamples: ["#老婆", "#老公图片", "#女儿列表"],
    build: slots => {
      const relation = cleanEnum(slots.relation, ["老婆", "老公", "女友", "男友", "女儿", "儿子"])
      const view = slots.view
        ? cleanEnum(slots.view, ["卡片", "图片", "列表"])
        : "卡片"
      return `#${relation}${view === "卡片" ? "" : view}`
    },
    validateCommand: /^#(老婆|老公|女友|男友|女儿|儿子)(图片|列表)?$/,
  },
  {
    id: "miao.relationship_set",
    plugin: "miao",
    description: "设置喵喵老婆、老公、女友、男友、女儿或儿子角色",
    intentExamples: ["把纳西妲设为女儿", "设置胡桃为老婆"],
    keywords: ["原神", "老婆", "老公", "女友", "男友", "女儿", "儿子", "设置"],
    risk: "write",
    autoExecute: false,
    runtimeAliases: MIAO_RUNTIME_ALIASES,
    games: ["genshin"],
    characterSlot: "character",
    slots: [
      {
        name: "relation",
        required: true,
        description: "关系称呼",
        allowedValues: ["老婆", "老公", "女友", "男友", "女儿", "儿子"],
      },
      {
        name: "character",
        required: true,
        description: "要设置的原神角色",
      },
    ],
    commandExamples: ["#老婆设置胡桃", "#女儿设置纳西妲"],
    build: slots => {
      const relation = cleanEnum(slots.relation, ["老婆", "老公", "女友", "男友", "女儿", "儿子"])
      const character = resolveWhitelistedCharacter(slots.character, ["genshin"])
      return `#${relation}设置${character.character}`
    },
    validateCommand: /^#(老婆|老公|女友|男友|女儿|儿子)设置[^#\n]{1,24}$/,
  },
  gameUidBinding({
    id: "genshin.bind_uid",
    game: "genshin",
    prefix: "",
    intentExamples: [
      "我怎么绑定原神",
      "绑定原神 UID",
      "把我的原神 UID 绑到机器人",
    ],
  }),
  gameUidBinding({
    id: "starrail.bind_uid",
    game: "starrail",
    prefix: "星铁",
    intentExamples: ["星铁怎么绑定 UID", "绑定星铁账号", "绑定星穹铁道 UID"],
    runtimeAliases: [...GENSHIN_RUNTIME_ALIASES, ...STARRAIL_RUNTIME_ALIASES],
  }),
  gameUidBinding({
    id: "zzz.bind_uid",
    game: "zzz",
    prefix: "绝区零",
    intentExamples: ["绝区零怎么绑定 UID", "绑定绝区零账号 UID"],
  }),
  gameUidLookup({
    id: "genshin.show_uid",
    game: "genshin",
    prefix: "",
    intentExamples: ["看看我绑定的原神 UID", "我的原神 UID 是多少"],
  }),
  gameUidLookup({
    id: "starrail.show_uid",
    game: "starrail",
    prefix: "星铁",
    intentExamples: ["看看我绑定的星铁 UID", "我的星穹铁道 UID"],
  }),
  gameUidLookup({
    id: "zzz.show_uid",
    game: "zzz",
    prefix: "绝区零",
    intentExamples: ["看看我绑定的绝区零 UID", "我的绝区零 UID"],
  }),
  ...fixedCommandGroup(
    {
      plugin: "genshin",
      runtimeAliases: GENSHIN_RUNTIME_ALIASES,
    },
    [
      {
        id: "genshin.role_card",
        description: "查看原神账号角色卡片和角色数据",
        command: "#角色卡片",
        intentExamples: ["看看我的原神角色", "查询原神角色卡片"],
        keywords: ["原神", "角色", "卡片", "账号", "角色数据"],
        games: ["genshin"],
      },
      {
        id: "genshin.exploration",
        description: "查看原神地图探索、宝箱和声望进度",
        command: "#探索",
        intentExamples: ["看看我的原神探索度", "原神地图探索进度"],
        keywords: ["原神", "探索", "探索度", "地图", "宝箱", "声望"],
        games: ["genshin"],
      },
      {
        id: "genshin.abyss",
        description: "查看自己的原神深境螺旋挑战记录",
        command: "#深渊",
        intentExamples: ["看看我的原神深渊", "查询深境螺旋战绩"],
        keywords: ["原神", "深渊", "深境螺旋", "战绩", "挑战记录"],
        games: ["genshin"],
      },
      {
        id: "genshin.theater",
        description: "查看自己的原神幻想真境剧诗挑战记录",
        command: "#幻想真境剧诗",
        intentExamples: ["看看我的幻想真境剧诗", "查询原神剧诗战绩"],
        keywords: ["原神", "幻想真境剧诗", "剧诗", "战绩"],
        games: ["genshin"],
      },
      {
        id: "genshin.ledger",
        description: "查看原神旅行者札记和当月原石收入",
        command: "#原石",
        intentExamples: ["这个月拿了多少原石", "看看旅行者札记", "原神月度收入"],
        keywords: ["原神", "原石", "札记", "收入", "月度", "获取"],
        games: ["genshin"],
      },
      {
        id: "genshin.development_help",
        description: "查看原神角色养成材料计算命令说明",
        command: "#角色养成",
        intentExamples: ["原神养成计算怎么用", "看看角色养成材料计算帮助"],
        keywords: ["原神", "角色", "养成", "材料", "计算", "帮助"],
        games: ["genshin"],
      },
      {
        id: "genshin.announcements",
        description: "查看原神官方公告和资讯",
        command: "#原神公告",
        intentExamples: ["看看原神最新公告", "原神最近有什么资讯"],
        keywords: ["原神", "官方", "公告", "资讯", "活动"],
        games: ["genshin"],
      },
      {
        id: "genshin.redemption_codes",
        description: "查看原神前瞻直播兑换码",
        command: "#原神兑换码",
        intentExamples: ["原神前瞻兑换码", "看看原神直播兑换码"],
        keywords: ["原神", "前瞻", "直播", "兑换码", "礼包码"],
        games: ["genshin"],
      },
      {
        id: "genshin.weapon_list",
        description: "查看原神账号的武器列表",
        command: "#武器",
        intentExamples: ["看看我的原神武器", "查询账号武器列表"],
        keywords: ["原神", "武器", "武器列表", "账号"],
        games: ["genshin"],
      },
      {
        id: "genshin.birthday_card",
        description: "查看原神角色生日留影卡",
        command: "#留影叙佳期",
        intentExamples: ["看看角色生日卡", "领取今天的生日留影"],
        keywords: ["原神", "角色", "生日", "生日卡", "留影叙佳期"],
        games: ["genshin"],
      },
      {
        id: "genshin.seven_saints_decks",
        description: "查看七圣召唤牌组列表",
        command: "#七圣查询牌组列表",
        intentExamples: ["看看七圣召唤牌组", "七圣有什么卡组"],
        keywords: ["原神", "七圣召唤", "七圣", "牌组", "卡组", "列表"],
        games: ["genshin"],
      },
      {
        id: "genshin.seven_saints_cards",
        description: "查看七圣召唤角色牌和行动牌列表",
        command: "#七圣查询卡牌列表",
        intentExamples: ["看看七圣卡牌列表", "七圣有哪些角色牌"],
        keywords: ["原神", "七圣召唤", "七圣", "角色牌", "行动牌", "卡牌"],
        games: ["genshin"],
      },
      {
        id: "genshin.gacha_help",
        description: "查看原神和星铁抽卡记录导入教程",
        command: "#抽卡帮助",
        intentExamples: ["原神抽卡记录怎么导入", "看看抽卡记录帮助"],
        keywords: ["原神", "星铁", "抽卡", "祈愿", "记录", "导入", "帮助"],
        games: ["genshin", "starrail"],
      },
      {
        id: "genshin.strategy_help",
        description: "查看原神角色攻略来源和编号说明",
        command: "#攻略帮助",
        intentExamples: ["原神攻略图编号怎么选", "查看攻略帮助"],
        keywords: ["原神", "角色", "攻略", "来源", "编号", "帮助"],
        games: ["genshin"],
      },
      {
        id: "genshin.ledger_stats",
        description: "统计原神旅行者札记中的原石收入",
        command: "#原石统计",
        intentExamples: ["统计一下原石收入", "看看旅行者札记汇总"],
        keywords: ["原神", "原石", "札记", "收入", "统计", "汇总"],
        games: ["genshin"],
      },
      {
        id: "genshin.cookie_help",
        description: "查看原神实时便笺和 Cookie 绑定帮助；不会提交凭据",
        command: "#体力帮助",
        intentExamples: ["原神体力查询怎么绑定", "看看 Cookie 绑定帮助"],
        keywords: ["原神", "体力", "树脂", "Cookie", "绑定", "帮助"],
        games: ["genshin"],
      },
      {
        id: "zzz.bangboo",
        description: "查看绝区零邦布列表",
        command: "#绝区零邦布",
        intentExamples: ["看看绝区零邦布", "我有哪些邦布"],
        keywords: ["绝区零", "邦布", "人偶", "列表"],
        games: ["zzz"],
      },
      {
        id: "zzz.sanity",
        description: "查询绝区零电量和实时便笺数据",
        command: "#绝区零体力",
        intentExamples: ["看看绝区零体力", "我的绝区零电量还有多少"],
        keywords: ["绝区零", "体力", "电量", "便笺", "日常"],
        games: ["zzz"],
      },
      {
        id: "zzz.announcements",
        description: "查看绝区零官方公告和资讯",
        command: "#绝区零公告",
        intentExamples: ["看看绝区零最新公告", "绝区零最近有什么资讯"],
        keywords: ["绝区零", "官方", "公告", "资讯", "活动"],
        games: ["zzz"],
      },
      {
        id: "zzz.redemption_codes",
        description: "查看绝区零前瞻直播兑换码",
        command: "#绝区零兑换码",
        intentExamples: ["绝区零前瞻兑换码", "看看绝区零直播兑换码"],
        keywords: ["绝区零", "前瞻", "直播", "兑换码", "礼包码"],
        games: ["zzz"],
      },
    ],
  ),
  {
    id: "genshin.character_detail",
    plugin: "genshin",
    description: "查看原神指定角色的账号基础信息",
    intentExamples: ["看看我的胡桃", "查询账号里的纳西妲"],
    keywords: ["原神", "角色", "等级", "好感", "账号", "详情"],
    risk: "read",
    autoExecute: true,
    runtimeAliases: GENSHIN_RUNTIME_ALIASES,
    runtimeRuleOptional: true,
    games: ["genshin"],
    characterSlot: "character",
    slots: [
      {
        name: "character",
        required: true,
        description: "原神角色名称或常用别名",
      },
    ],
    commandExamples: ["#胡桃", "#纳西妲"],
    build: slots => {
      const character = resolveWhitelistedCharacter(slots.character, ["genshin"])
      return `#${character.character}`
    },
    validateCommand: /^#[^#\n]{1,24}$/,
  },
  {
    id: "genshin.character_development",
    plugin: "genshin",
    description: "计算原神或星铁指定角色的养成材料",
    intentExamples: ["算一下胡桃养成材料", "黄泉升满需要什么材料"],
    keywords: ["原神", "星铁", "角色", "养成", "培养", "材料", "计算"],
    risk: "read",
    autoExecute: true,
    runtimeAliases: GENSHIN_RUNTIME_ALIASES,
    games: ["genshin", "starrail"],
    characterSlot: "character",
    slots: [
      {
        name: "character",
        required: true,
        description: "原神或星铁角色名称或常用别名",
      },
      {
        name: "levels",
        required: false,
        description: "可选的等级或技能目标，使用数字、空格或逗号，例如 90,10,10,10",
      },
    ],
    commandExamples: ["#胡桃养成", "#星铁黄泉养成90,10,10,10"],
    build: (slots, { context } = {}) => {
      const character = resolveWhitelistedCharacter(
        slots.character,
        gamesFromContext(context, ["genshin", "starrail"]),
      )
      const gamePrefix = character.game === "starrail" ? "星铁" : ""
      const levels = slots.levels
        ? cleanPatternValue(slots.levels, /^[0-9,， ]{1,32}$/, "等级目标只能包含数字、空格或逗号")
        : ""
      return `#${gamePrefix}${character.character}养成${levels}`
    },
    validateCommand: /^#(星铁)?[^#\n]{1,24}养成[0-9,， ]{0,32}$/,
  },
  {
    id: "genshin.character_materials",
    plugin: "genshin",
    description: "查看原神或星铁指定角色的突破与培养材料",
    intentExamples: ["胡桃突破要什么", "看看黄泉培养素材"],
    keywords: ["原神", "星铁", "角色", "突破", "培养", "材料", "素材"],
    risk: "read",
    autoExecute: true,
    runtimeAliases: GENSHIN_RUNTIME_ALIASES,
    games: ["genshin", "starrail"],
    characterSlot: "character",
    slots: [
      {
        name: "character",
        required: true,
        description: "原神或星铁角色名称或常用别名",
      },
    ],
    commandExamples: ["#胡桃材料", "#星铁黄泉材料"],
    build: (slots, { context } = {}) => {
      const character = resolveWhitelistedCharacter(
        slots.character,
        gamesFromContext(context, ["genshin", "starrail"]),
      )
      const gamePrefix = character.game === "starrail" ? "星铁" : ""
      return `#${gamePrefix}${character.character}材料`
    },
    validateCommand: /^#(星铁)?[^#\n]{1,24}材料$/,
  },
  {
    id: "genshin.gacha_records",
    plugin: "genshin",
    description: "查看原神或星铁的原生抽卡记录、分析或统计",
    intentExamples: ["看看原神抽卡记录", "统计星铁光锥跃迁", "分析我的常驻池"],
    keywords: ["原神", "星铁", "抽卡", "祈愿", "跃迁", "记录", "分析", "统计"],
    risk: "read",
    autoExecute: true,
    runtimeAliases: GENSHIN_RUNTIME_ALIASES,
    games: ["genshin", "starrail"],
    slots: [
      {
        name: "game",
        required: false,
        description: "游戏；没有明确说明时使用原神",
        allowedValues: ["原神", "星铁"],
      },
      {
        name: "pool",
        required: false,
        description: "卡池类型；没有明确说明时使用抽卡",
        allowedValues: ["抽卡", "角色", "角色联动", "武器", "武器联动", "集录", "常驻", "新手", "光锥", "光锥联动", "全部"],
      },
      {
        name: "view",
        required: false,
        description: "查看记录、分析还是统计；没有明确说明时使用记录",
        allowedValues: ["记录", "分析", "统计"],
      },
    ],
    commandExamples: ["#抽卡记录", "#角色池统计", "#星铁光锥记录"],
    build: slots => {
      const game = slots.game ? cleanEnum(slots.game, ["原神", "星铁"]) : "原神"
      const pool = slots.pool
        ? cleanEnum(slots.pool, ["抽卡", "角色", "角色联动", "武器", "武器联动", "集录", "常驻", "新手", "光锥", "光锥联动", "全部"])
        : "抽卡"
      const view = slots.view
        ? cleanEnum(slots.view, ["记录", "分析", "统计"])
        : "记录"
      if (
        view === "统计" &&
        ["角色联动", "武器联动", "光锥联动", "全部"].includes(pool)
      ) {
        throw new Error("这个卡池类型不支持统计，请改用记录或分析")
      }
      const poolText = view === "统计" && pool !== "抽卡" ? `${pool}池` : pool
      return `#${game === "星铁" ? "星铁" : ""}${poolText}${view}`
    },
    validateCommand: /^#(星铁)?(?:(抽卡|角色|角色联动|武器|武器联动|集录|常驻|新手|光锥|光锥联动|全部)(记录|分析)|(抽卡|角色池|武器池|集录池|常驻池|新手池|光锥池)统计)$/,
  },
  {
    id: "genshin.gacha_platform_help",
    plugin: "genshin",
    description: "查看电脑、安卓或苹果设备的抽卡记录获取教程",
    intentExamples: ["电脑怎么导入抽卡记录", "苹果抽卡记录教程", "安卓祈愿记录怎么弄"],
    keywords: ["原神", "抽卡", "记录", "电脑", "PC", "安卓", "苹果", "iOS", "教程"],
    risk: "read",
    autoExecute: true,
    runtimeAliases: GENSHIN_RUNTIME_ALIASES,
    games: ["genshin", "starrail"],
    slots: [
      {
        name: "platform",
        required: true,
        description: "设备平台",
        allowedValues: ["电脑", "安卓", "苹果"],
      },
    ],
    commandExamples: ["#电脑帮助", "#安卓帮助", "#苹果帮助"],
    build: slots => `#${cleanEnum(slots.platform, ["电脑", "安卓", "苹果"])}帮助`,
    validateCommand: /^#(电脑|安卓|苹果)帮助$/,
  },
  {
    id: "genshin.abyss_floor",
    plugin: "genshin",
    description: "查看原神指定期数和楼层的深境螺旋记录",
    intentExamples: ["看看上期深渊十二层", "查询本期深渊十一层"],
    keywords: ["原神", "深渊", "深境螺旋", "本期", "上期", "楼层", "战绩"],
    risk: "read",
    autoExecute: true,
    runtimeAliases: GENSHIN_RUNTIME_ALIASES,
    games: ["genshin"],
    slots: [
      {
        name: "period",
        required: false,
        description: "本期或上期；没有明确说明时使用本期",
        allowedValues: ["本期", "上期"],
      },
      {
        name: "floor",
        required: true,
        description: "深渊楼层",
        allowedValues: ["9", "10", "11", "12"],
      },
    ],
    commandExamples: ["#深渊12层", "#上期深渊11层"],
    build: slots => {
      const period = slots.period ? cleanEnum(slots.period, ["本期", "上期"]) : ""
      const floor = cleanEnum(slots.floor, ["9", "10", "11", "12"])
      return `#${period}深渊${floor}层`
    },
    validateCommand: /^#(本期|上期)?深渊(9|10|11|12)层$/,
  },
  {
    id: "genshin.ledger_history",
    plugin: "genshin",
    description: "查看指定年份的原石或星琼收入统计",
    intentExamples: ["看看去年原石统计", "查询今年星琼收入", "2025 年原石汇总"],
    keywords: ["原神", "星铁", "原石", "星琼", "去年", "今年", "年度", "统计"],
    risk: "read",
    autoExecute: true,
    runtimeAliases: GENSHIN_RUNTIME_ALIASES,
    games: ["genshin", "starrail"],
    slots: [
      {
        name: "game",
        required: false,
        description: "游戏；没有明确说明时使用原神",
        allowedValues: ["原神", "星铁"],
      },
      {
        name: "period",
        required: true,
        description: "去年、今年或四位年份",
      },
    ],
    commandExamples: ["#去年原石统计", "#今年星铁星琼统计", "#2025年原石统计"],
    build: slots => {
      const game = slots.game ? cleanEnum(slots.game, ["原神", "星铁"]) : "原神"
      const period = cleanPatternValue(
        slots.period,
        /^(去年|今年|20\d{2}年)$/,
        "统计周期必须是去年、今年或四位年份加“年”",
      )
      return `#${period}${game === "星铁" ? "星铁星琼" : "原石"}统计`
    },
    validateCommand: /^#(去年|今年|20\d{2}年)(原石|星铁星琼)统计$/,
  },
  {
    id: "genshin.blueprint",
    plugin: "genshin",
    description: "计算原神尘歌壶模数所需的摆设材料",
    intentExamples: ["计算这个尘歌壶模数", "尘歌壶模数 1234567890 要什么材料"],
    keywords: ["原神", "尘歌壶", "模数", "摆设", "养成", "材料", "计算"],
    risk: "read",
    autoExecute: true,
    runtimeAliases: GENSHIN_RUNTIME_ALIASES,
    games: ["genshin"],
    slots: [
      {
        name: "id",
        required: true,
        description: "10 到 15 位尘歌壶模数 ID",
      },
    ],
    commandExamples: ["#尘歌壶模数1234567890"],
    build: slots => `#尘歌壶模数${cleanPatternValue(slots.id, /^\d{10,15}$/, "尘歌壶模数必须是 10 到 15 位数字")}`,
    validateCommand: /^#尘歌壶模数\d{10,15}$/,
  },
  {
    id: "genshin.news_estimate",
    plugin: "genshin",
    description: "查看原神、星铁或绝区零当前版本可获取资源预估",
    intentExamples: ["这个版本原神能拿多少原石", "星铁版本星琼预估", "绝区零菲林盘点"],
    keywords: ["原神", "星铁", "绝区零", "原石", "星琼", "菲林", "预估", "盘点"],
    risk: "read",
    autoExecute: true,
    runtimeAliases: GENSHIN_RUNTIME_ALIASES,
    games: ["genshin", "starrail", "zzz"],
    slots: [
      {
        name: "game",
        required: true,
        description: "游戏",
        allowedValues: ["原神", "星铁", "绝区零"],
      },
    ],
    commandExamples: ["#原神预估", "#星铁预估", "#绝区零预估"],
    build: slots => `#${cleanEnum(slots.game, ["原神", "星铁", "绝区零"])}预估`,
    validateCommand: /^#(原神|星铁|绝区零)预估$/,
  },
  {
    id: "genshin.redeem_code",
    plugin: "genshin",
    description: "为原神、星铁或绝区零账号使用一个兑换码",
    intentExamples: ["帮我兑换这个原神礼包码", "使用星铁兑换码"],
    keywords: ["原神", "星铁", "绝区零", "兑换码", "礼包码", "使用", "兑换"],
    risk: "write",
    autoExecute: false,
    runtimeAliases: GENSHIN_RUNTIME_ALIASES,
    games: ["genshin", "starrail", "zzz"],
    slots: [
      {
        name: "game",
        required: true,
        description: "游戏",
        allowedValues: ["原神", "星铁", "绝区零"],
      },
      {
        name: "code",
        required: true,
        description: "6 到 32 位字母或数字兑换码",
      },
    ],
    commandExamples: ["#原神兑换码使用GENSHINGIFT", "#星铁兑换码使用STARRAIL123"],
    build: slots => {
      const game = cleanEnum(slots.game, ["原神", "星铁", "绝区零"])
      const code = cleanPatternValue(slots.code, /^[A-Za-z0-9]{6,32}$/, "兑换码只能包含 6 到 32 位字母或数字")
      return `#${game}兑换码使用${code}`
    },
    validateCommand: /^#(原神|星铁|绝区零)兑换码使用[A-Za-z0-9]{6,32}$/,
  },
  commandFamily({
    id: "genshin.simulate_gacha",
    plugin: "genshin",
    description: "执行原神模拟单抽或十连，并可指定角色、武器或常驻池",
    intentExamples: ["模拟一次原神十连", "来个武器池十连", "模拟单抽"],
    keywords: ["原神", "模拟", "抽卡", "单抽", "十连", "武器池", "常驻"],
    risk: "write",
    autoExecute: false,
    runtimeAliases: GENSHIN_RUNTIME_ALIASES,
    games: ["genshin"],
    slots: [
      { name: "count", required: false, description: "单抽或十连；未说明时十连", allowedValues: ["单抽", "十连"] },
      { name: "pool", required: false, description: "角色、武器或常驻；未说明时默认池", allowedValues: ["角色", "武器", "常驻"] },
      { name: "index", required: false, description: "可选的卡池编号 1、2 或 3", allowedValues: ["1", "2", "3"] },
    ],
    commandExamples: ["#十连", "#十连武器2", "#单抽常驻"],
    build: slots => {
      const count = slots.count ? cleanEnum(slots.count, ["单抽", "十连"]) : "十连"
      const pool = slots.pool ? cleanEnum(slots.pool, ["角色", "武器", "常驻"]) : ""
      const index = slots.index ? cleanEnum(slots.index, ["1", "2", "3"]) : ""
      return `#${count}${pool}${index}`
    },
    validateCommand: /^#(单抽|十连)(角色|武器|常驻)?[123]?$/,
  }),
  commandFamily({
    id: "genshin.weapon_course",
    plugin: "genshin",
    description: "查看或设置原神模拟武器池定轨",
    intentExamples: ["切换模拟武器池定轨", "设置定轨护摩之杖", "查看当前定轨"],
    keywords: ["原神", "模拟", "武器池", "定轨", "设置", "查看"],
    risk: "write",
    autoExecute: false,
    runtimeAliases: GENSHIN_RUNTIME_ALIASES,
    games: ["genshin"],
    slots: [{ name: "weapon", required: false, description: "要定轨的武器；留空查看当前定轨" }],
    commandExamples: ["#定轨", "#定轨护摩之杖"],
    build: slots => `#定轨${slots.weapon ? cleanEntity(slots.weapon) : ""}`,
    validateCommand: /^#定轨[^#\r\n]{0,24}$/,
  }),
  ...fixedCommandGroup(
    {
      plugin: "starrail",
      runtimeAliases: STARRAIL_RUNTIME_ALIASES,
      games: ["starrail"],
    },
    [
      {
        id: "starrail.help",
        description: "查看星铁插件帮助和功能菜单",
        command: "*帮助",
        intentExamples: ["星铁插件怎么用", "看看星铁命令菜单"],
        keywords: ["星铁", "星穹铁道", "帮助", "菜单", "功能"],
      },
      {
        id: "starrail.sanity",
        description: "查询星铁开拓力、委托和实时便笺数据",
        command: "*体力",
        intentExamples: ["看看星铁体力", "我的开拓力还有多少"],
        keywords: ["星铁", "星穹铁道", "体力", "开拓力", "委托", "便笺"],
      },
      {
        id: "starrail.monthly_income",
        description: "查看星铁开拓月历和当月星琼收入",
        command: "*收入",
        intentExamples: ["这个月拿了多少星琼", "看看星铁月度收入"],
        keywords: ["星铁", "星琼", "收入", "开拓月历", "月度", "获取"],
      },
      {
        id: "starrail.card",
        description: "查看星铁账号角色卡片和探索信息",
        command: "*卡片",
        intentExamples: ["看看我的星铁卡片", "查询星穹铁道角色数据"],
        keywords: ["星铁", "星穹铁道", "角色", "卡片", "账号", "探索"],
      },
      {
        id: "starrail.online_stats",
        description: "根据开拓力记录查看星铁在线时长统计",
        command: "*在线时长",
        intentExamples: ["看看我的星铁在线时长", "统计星铁在线时间"],
        keywords: ["星铁", "在线", "在线时长", "时间", "统计"],
      },
      {
        id: "starrail.gacha_help",
        description: "查看星铁跃迁记录绑定和导入教程",
        command: "*抽卡帮助",
        intentExamples: ["星铁抽卡记录怎么导入", "看看跃迁链接绑定教程"],
        keywords: ["星铁", "跃迁", "抽卡", "记录", "链接", "导入", "帮助"],
      },
      {
        id: "starrail.strategy_help",
        description: "查看星铁角色攻略来源和编号说明",
        command: "*攻略帮助",
        intentExamples: ["星铁攻略图编号怎么选", "查看星铁攻略帮助"],
        keywords: ["星铁", "角色", "攻略", "来源", "编号", "帮助"],
      },
      {
        id: "starrail.gacha_records",
        description: "查看星铁跃迁记录和抽卡分析",
        command: "*跃迁分析",
        intentExamples: ["看看我的星铁跃迁记录", "分析一下星铁抽卡"],
        keywords: ["星铁", "跃迁", "抽卡", "记录", "分析", "统计"],
      },
      {
        id: "starrail.challenge_overview",
        description: "查看星铁忘却、虚构、末日和仲裁挑战总览",
        command: "*深渊",
        intentExamples: ["看看我的星铁深渊", "星铁挑战战绩总览"],
        keywords: ["星铁", "深渊", "忘却", "混沌", "虚构", "末日", "仲裁", "战绩"],
      },
      {
        id: "starrail.simulated_universe",
        description: "查看星铁模拟宇宙挑战记录",
        command: "*宇宙",
        intentExamples: ["看看我的模拟宇宙", "星铁宇宙战绩"],
        keywords: ["星铁", "模拟宇宙", "宇宙", "战绩", "挑战"],
      },
      {
        id: "starrail.divergent_universe",
        description: "查看星铁差分宇宙挑战记录",
        command: "*差分",
        intentExamples: ["看看我的差分宇宙", "星铁差分战绩"],
        keywords: ["星铁", "差分宇宙", "差分", "演算", "战绩"],
      },
      {
        id: "starrail.strength_rank",
        description: "查看星铁全角色强度榜参考图",
        command: "*强度榜",
        intentExamples: ["看看星铁角色强度榜", "星铁哪些角色比较强"],
        keywords: ["星铁", "角色", "强度榜", "强度", "排行", "参考"],
      },
      {
        id: "starrail.development_help",
        description: "查看星铁角色养成材料计算命令说明",
        command: "#星铁角色养成",
        intentExamples: ["星铁养成计算怎么用", "看看星铁角色养成计算帮助"],
        keywords: ["星铁", "角色", "养成", "材料", "计算", "帮助"],
        runtimeAliases: GENSHIN_RUNTIME_ALIASES,
      },
      {
        id: "starrail.announcements",
        description: "查看星铁官方公告和资讯",
        command: "#星铁公告",
        intentExamples: ["看看星铁最新公告", "星穹铁道最近有什么资讯"],
        keywords: ["星铁", "星穹铁道", "官方", "公告", "资讯", "活动"],
        runtimeAliases: GENSHIN_RUNTIME_ALIASES,
      },
      {
        id: "starrail.redemption_codes",
        description: "查看星铁前瞻直播兑换码",
        command: "*兑换码",
        intentExamples: ["星铁前瞻兑换码", "看看星穹铁道直播兑换码"],
        keywords: ["星铁", "星穹铁道", "前瞻", "直播", "兑换码", "礼包码"],
        runtimeAliases: GENSHIN_RUNTIME_ALIASES,
      },
    ],
  ),
  fixedCommand({
    id: "miao.genshin_calendar",
    plugin: "miao",
    description: "查看原神活动日历",
    command: "#日历",
    intentExamples: ["看看原神日历", "原神最近有什么活动", "原神活动时间"],
    keywords: ["原神", "日历", "活动", "卡池"],
    runtimeAliases: MIAO_RUNTIME_ALIASES,
    games: ["genshin"],
  }),
  fixedCommand({
    id: "miao.starrail_calendar",
    plugin: "miao",
    description: "查看崩坏：星穹铁道活动日历",
    command: "#星铁日历",
    intentExamples: ["看看星铁日历", "星穹铁道最近有什么活动", "铁道活动时间"],
    keywords: ["星铁", "星穹铁道", "铁道", "日历", "活动", "卡池"],
    runtimeAliases: MIAO_RUNTIME_ALIASES,
    games: ["starrail"],
  }),
  fixedCommand({
    id: "miao.zzz_calendar",
    plugin: "miao",
    description: "查看绝区零活动日历",
    command: "#绝区零日历",
    intentExamples: ["看看绝区零日历", "绝区零最近有什么活动"],
    keywords: ["绝区零", "绝区", "日历", "活动", "卡池"],
    runtimeAliases: ["miao-plugin", "喵喵"],
    games: ["zzz"],
  }),
  {
    id: "miao.today_material",
    plugin: "miao",
    description: "查询原神今天、明天或指定星期的角色培养材料",
    intentExamples: ["今天刷什么材料", "原神明天的天赋材料", "周三素材"],
    keywords: ["原神", "今日", "今天", "明天", "素材", "材料", "天赋", "星期", "周"],
    risk: "read",
    autoExecute: true,
    runtimeAliases: ["miao-plugin", "喵喵"],
    games: ["genshin"],
    slots: [
      {
        name: "day",
        required: false,
        description: "查询日期，不确定时留空表示今天",
        allowedValues: [
          "今天",
          "明天",
          "周一",
          "周二",
          "周三",
          "周四",
          "周五",
          "周六",
          "周日",
        ],
      },
    ],
    commandExamples: ["#今日素材", "#明天素材", "#周三素材"],
    build: slots => {
      const day = slots.day
        ? cleanEnum(slots.day, [
            "今天",
            "明天",
            "周一",
            "周二",
            "周三",
            "周四",
            "周五",
            "周六",
            "周日",
          ])
        : "今日"
      return `#${day}素材`
    },
    validateCommand: /^#(今日|今天|明天|周[一二三四五六日])素材$/,
  },
  {
    id: "miao.profile_list",
    plugin: "miao",
    description: "查看已经获取面板数据的角色列表",
    intentExamples: ["看看我的面板角色", "有哪些角色面板", "星铁面板列表"],
    keywords: ["原神", "星铁", "面板", "角色", "列表", "已有"],
    risk: "read",
    autoExecute: true,
    runtimeAliases: [...MIAO_RUNTIME_ALIASES, ...STARRAIL_RUNTIME_ALIASES],
    games: ["genshin", "starrail"],
    slots: [
      {
        name: "game",
        required: false,
        description: "游戏；没有明确说明时留空",
        allowedValues: ["原神", "星铁"],
      },
    ],
    commandExamples: ["#面板列表", "#原神面板列表", "#星铁面板列表"],
    build: slots => {
      const game = slots.game ? cleanEnum(slots.game, ["原神", "星铁"]) : ""
      return `#${game}面板列表`
    },
    validateCommand: /^#(原神|星铁)?面板列表$/,
  },
  {
    id: "miao.profile_detail",
    plugin: "miao",
    description: "查询原神或星铁某个角色的面板、圣遗物、遗器、武器或伤害",
    intentExamples: [
      "看看胡桃面板",
      "查询雷电将军圣遗物",
      "看一下黄泉的遗器",
      "流萤伤害怎么样",
    ],
    keywords: [
      "原神",
      "星铁",
      "角色",
      "面板",
      "圣遗物",
      "遗器",
      "武器",
      "伤害",
      "胡桃",
      "雷电将军",
      "黄泉",
      "流萤",
      "遐蝶",
    ],
    risk: "read",
    autoExecute: true,
    runtimeAliases: [...MIAO_RUNTIME_ALIASES, ...STARRAIL_RUNTIME_ALIASES],
    games: ["genshin", "starrail"],
    characterSlot: "character",
    slots: [
      {
        name: "character",
        required: true,
        description: "角色名称或常用别名",
      },
      {
        name: "view",
        required: false,
        description: "想看的数据，没有明确说明时使用面板",
        allowedValues: ["面板", "详情", "圣遗物", "遗器", "武器", "伤害"],
      },
    ],
    commandExamples: ["#胡桃面板", "#星铁黄泉遗器", "#星铁遐蝶面板"],
    build: (slots, { context } = {}) => {
      const character = resolveWhitelistedCharacter(
        slots.character,
        gamesFromContext(context, ["genshin", "starrail"]),
      )
      const view = slots.view
        ? cleanEnum(slots.view, ["面板", "详情", "圣遗物", "遗器", "武器", "伤害"])
        : "面板"
      const gamePrefix = character.game === "starrail" ? "星铁" : ""
      return `#${gamePrefix}${character.character}${view}`
    },
    validateCommand:
      /^#(星铁)?[^#\n]{1,24}(面板|详情|圣遗物|遗器|武器|伤害)$/,
  },
  // miao-plugin 的角色卡按钮会跳转到这两个攻略命令，但真正的处理器分别
  // 位于 genshin 与 StarRail-plugin。候选放在 miao 预设中可兼容已有配置，
  // 运行前仍会检查对应处理器是否确实加载并能匹配生成的命令。
  characterGuide({
    id: "genshin.guide",
    plugin: "genshin",
    description: "查询原神指定角色的培养攻略图",
    game: "genshin",
    prefix: "#",
    intentExamples: [
      "看看胡桃攻略",
      "木偶怎么培养",
      "给我桑多涅的配队攻略",
    ],
    keywords: ["原神", "角色", "攻略", "培养", "配队", "攻略图"],
    commandExamples: ["#胡桃攻略", "#桑多涅攻略"],
    runtimeAliases: ["genshin/index.js", "Yunzai-genshin", "米游社攻略"],
  }),
  characterGuide({
    id: "starrail.guide",
    plugin: "starrail",
    description: "查询星铁指定角色的培养攻略图",
    game: "starrail",
    prefix: "*",
    intentExamples: [
      "看看遐蝶攻略",
      "黄泉怎么培养",
      "给我流萤的配队攻略",
    ],
    keywords: ["星铁", "星穹铁道", "角色", "攻略", "培养", "配队", "攻略图"],
    commandExamples: ["*遐蝶攻略", "*黄泉攻略"],
    runtimeAliases: [
      "StarRail-plugin",
      "starrail-plugin",
      "米游社星铁攻略",
    ],
  }),
  {
    id: "miao.profile_stats",
    plugin: "miao",
    description: "查看原神或星铁角色面板练度统计",
    intentExamples: ["看看我的练度统计", "统计一下原神角色练度", "星铁面板练度"],
    keywords: ["原神", "星铁", "面板", "练度", "统计", "角色"],
    risk: "read",
    autoExecute: true,
    runtimeAliases: ["miao-plugin", "喵喵"],
    games: ["genshin", "starrail"],
    slots: [
      {
        name: "game",
        required: false,
        description: "游戏；没有明确说明时留空",
        allowedValues: ["原神", "星铁"],
      },
    ],
    commandExamples: ["#面板练度统计", "#原神面板练度统计", "#星铁面板练度统计"],
    build: slots => {
      const game = slots.game ? cleanEnum(slots.game, ["原神", "星铁"]) : ""
      return `#${game}面板练度统计`
    },
    validateCommand: /^#(原神|星铁)?面板练度统计$/,
  },
  {
    id: "miao.gacha_summary",
    plugin: "miao",
    description: "查看原神或星铁的喵喵抽卡记录或统计",
    intentExamples: [
      "看看我的原神抽卡记录",
      "统计一下星铁抽卡",
      "喵喵祈愿分析",
    ],
    keywords: ["原神", "星铁", "喵喵", "抽卡", "祈愿", "记录", "统计", "分析"],
    risk: "read",
    autoExecute: true,
    runtimeAliases: ["miao-plugin", "喵喵"],
    games: ["genshin", "starrail"],
    slots: [
      {
        name: "game",
        required: false,
        description: "游戏；没有明确说明时留空表示原神",
        allowedValues: ["原神", "星铁"],
      },
      {
        name: "view",
        required: false,
        description: "要查看记录还是统计；没有明确说明时使用记录",
        allowedValues: ["记录", "统计"],
      },
    ],
    commandExamples: ["#喵喵抽卡记录", "#星铁喵喵抽卡统计"],
    build: slots => {
      const game = slots.game ? cleanEnum(slots.game, ["原神", "星铁"]) : "原神"
      const view = slots.view ? cleanEnum(slots.view, ["记录", "统计"]) : "记录"
      return `#${game === "星铁" ? "星铁" : ""}喵喵抽卡${view}`
    },
    validateCommand: /^#(星铁)?喵喵抽卡(记录|统计)$/,
  },
  fixedCommand({
    id: "miao.character_ownership",
    plugin: "miao",
    description: "查看原神角色持有率、命座与持有分布统计",
    command: "#角色持有率",
    intentExamples: ["看看原神角色持有率", "大家都有哪些角色", "角色持有分布"],
    keywords: ["原神", "角色", "持有率", "持有", "命座", "分布", "统计"],
    runtimeAliases: ["miao-plugin", "喵喵"],
    games: ["genshin"],
  }),
  fixedCommand({
    id: "miao.abyss_usage",
    plugin: "miao",
    description: "查看原神深渊角色出场率",
    command: "#深渊出场率",
    intentExamples: ["看看本期深渊出场率", "深渊哪些角色用得多"],
    keywords: ["原神", "深渊", "角色", "出场率", "使用率", "统计"],
    runtimeAliases: ["miao-plugin", "喵喵"],
    games: ["genshin"],
  }),
  fixedCommand({
    id: "miao.abyss_teams",
    plugin: "miao",
    description: "查看原神深渊常用配队",
    command: "#深渊配队",
    intentExamples: ["深渊怎么配队", "看看本期深渊队伍", "深渊组队推荐"],
    keywords: ["原神", "深渊", "配队", "组队", "队伍", "推荐"],
    runtimeAliases: ["miao-plugin", "喵喵"],
    games: ["genshin"],
  }),
  fixedCommand({
    id: "miao.abyss_data",
    plugin: "miao",
    description: "查看原神本期深境螺旋数据",
    command: "#深渊数据",
    intentExamples: ["看看本期深渊数据", "深境螺旋统计"],
    keywords: ["原神", "深渊", "深境螺旋", "数据", "统计", "本期"],
    runtimeAliases: ["miao-plugin", "喵喵"],
    games: ["genshin"],
  }),
  fixedCommand({
    id: "miao.theater_data",
    plugin: "miao",
    description: "查看原神幻想真境剧诗数据",
    command: "#幻想真境剧诗数据",
    intentExamples: ["看看幻想真境剧诗数据", "剧诗本期统计"],
    keywords: ["原神", "幻想真境剧诗", "剧诗", "幻想", "数据", "统计"],
    runtimeAliases: ["miao-plugin", "喵喵"],
    games: ["genshin"],
  }),
  fixedCommand({
    id: "miao.stygian_data",
    plugin: "miao",
    description: "查看原神幽境危战数据",
    command: "#幽境危战数据",
    intentExamples: ["看看幽境危战数据", "危战本期统计"],
    keywords: ["原神", "幽境危战", "幽境", "危战", "数据", "统计"],
    runtimeAliases: ["miao-plugin", "喵喵"],
    games: ["genshin"],
  }),
  fixedCommand({
    id: "miao.theater_card_exchange",
    plugin: "miao",
    description: "匹配幻想真境剧诗月谕圣牌交换信息",
    command: "#幻想真境剧诗圣牌交换",
    intentExamples: ["帮我匹配月谕圣牌交换", "看看谁能和我换剧诗卡牌"],
    keywords: ["原神", "幻想真境剧诗", "月谕圣牌", "卡牌", "交换", "换牌"],
    runtimeAliases: MIAO_RUNTIME_ALIASES,
    games: ["genshin"],
  }),
  commandFamily({
    id: "miao.character_image_upload",
    plugin: "miao",
    description: "上传指定原神角色的照片、写真或图片",
    intentExamples: ["上传一张胡桃照片", "给纳西妲添加写真"],
    keywords: ["喵喵", "原神", "角色", "上传", "添加", "照片", "写真", "图片"],
    risk: "admin",
    runtimeAliases: MIAO_RUNTIME_ALIASES,
    games: ["genshin"],
    characterSlot: "character",
    slots: [{ name: "character", required: true, description: "要上传图片的原神角色" }],
    commandExamples: ["#上传胡桃照片", "#喵喵添加纳西妲图片"],
    build: slots => {
      const character = resolveWhitelistedCharacter(slots.character, ["genshin"])
      return `#喵喵上传${character.character}图片`
    },
    validateCommand: /^#(喵喵)?(上传|添加)[^#\n]{1,24}(照片|写真|图片|图像)$/,
  }),
  ...fixedCommandGroup(
    {
      plugin: "miao",
      risk: "admin",
      autoExecute: false,
      runtimeAliases: MIAO_RUNTIME_ALIASES,
    },
    [
      {
        id: "miao.resource_update",
        description: "更新喵喵角色图像素材",
        command: "#喵喵更新图像",
        intentExamples: ["更新喵喵图像素材", "拉取喵喵最新角色图片"],
        keywords: ["喵喵", "更新", "图像", "图片", "素材"],
      },
      {
        id: "miao.resource_force_update",
        description: "强制覆盖更新喵喵角色图像素材",
        command: "#喵喵强制更新图像",
        intentExamples: ["强制更新喵喵图像素材"],
        keywords: ["喵喵", "强制", "覆盖", "更新", "图像", "素材"],
      },
      {
        id: "miao.plugin_update",
        description: "更新喵喵插件并在成功后重启机器人",
        command: "#喵喵更新",
        intentExamples: ["更新喵喵插件", "把喵喵升级到最新版"],
        keywords: ["喵喵", "插件", "更新", "升级", "重启"],
      },
      {
        id: "miao.plugin_force_update",
        description: "强制覆盖本地改动并更新喵喵插件",
        command: "#喵喵强制更新",
        intentExamples: ["强制更新喵喵插件", "覆盖本地改动更新喵喵"],
        keywords: ["喵喵", "插件", "强制", "覆盖", "更新"],
      },
      {
        id: "miao.api_info",
        description: "查看喵喵 API 状态与管理信息",
        command: "#喵喵api",
        intentExamples: ["查看喵喵 API", "喵喵接口状态"],
        keywords: ["喵喵", "API", "接口", "状态", "管理"],
      },
    ],
  ),
  commandFamily({
    id: "miao.settings",
    plugin: "miao",
    description: "查看或修改喵喵插件系统设置",
    intentExamples: ["打开喵喵设置", "修改喵喵功能配置"],
    keywords: ["喵喵", "主人", "设置", "配置", "开关", "管理"],
    risk: "admin",
    runtimeAliases: MIAO_RUNTIME_ALIASES,
    runtimeRuleOptional: true,
    slots: [
      { name: "setting", required: false, description: "配置项名称；留空查看设置面板" },
      { name: "value", required: false, description: "配置值；查看设置面板时留空" },
    ],
    commandExamples: ["#喵喵设置", "#喵喵设置 charWiki 开启"],
    build: slots => {
      const setting = slots.setting ? cleanEntity(slots.setting) : ""
      const value = slots.value ? cleanCommandArgument(slots.value, "配置值格式不正确", 40) : ""
      return `#喵喵设置${setting ? ` ${setting}` : ""}${value ? ` ${value}` : ""}`
    },
    validateCommand: /^#喵喵设置(?:\s+[^#\r\n]{1,80})?$/,
  }),
  commandFamily({
    id: "miao.profile_change",
    plugin: "miao",
    description: "对角色面板进行武器、圣遗物或属性替换计算",
    intentExamples: ["算算胡桃换护摩后的面板", "黄泉换遗器会怎样"],
    keywords: ["原神", "星铁", "角色", "面板", "替换", "更换", "换", "计算"],
    runtimeAliases: MIAO_RUNTIME_ALIASES,
    games: ["genshin", "starrail"],
    slots: [
      { name: "character", required: true, description: "角色名称或常用别名" },
      { name: "change", required: true, description: "要替换的武器、圣遗物、遗器或属性" },
    ],
    commandExamples: ["#胡桃换护摩之杖", "#星铁黄泉换遗器"],
    build: (slots, { context } = {}) => {
      const character = resolveWhitelistedCharacter(
        slots.character,
        gamesFromContext(context, ["genshin", "starrail"]),
      )
      const prefix = character.game === "starrail" ? "星铁" : ""
      return `#${prefix}${character.character}换${cleanCommandArgument(slots.change, "替换内容格式不正确", 48)}`
    },
    validateCommand: /^#[^#\r\n]{1,30}换[^#\r\n]{1,48}$/,
  }),
  commandFamily({
    id: "miao.group_best_profile",
    plugin: "miao",
    description: "查看群内指定角色的最强、最高分或极限面板",
    intentExamples: ["群里谁的胡桃最强", "看看黄泉最高分面板", "雷神极限面板"],
    keywords: ["原神", "星铁", "群内", "角色", "最强", "最高分", "第一", "极限", "面板"],
    runtimeAliases: MIAO_RUNTIME_ALIASES,
    games: ["genshin", "starrail"],
    characterSlot: "character",
    slots: [
      { name: "character", required: true, description: "要比较的角色" },
      { name: "mode", required: false, description: "最强、最高分、第一或极限", allowedValues: ["最强", "最高分", "第一", "极限"] },
    ],
    commandExamples: ["#群内最强胡桃", "#星铁最高分黄泉", "#极限雷电将军"],
    build: (slots, { context } = {}) => {
      const character = resolveWhitelistedCharacter(
        slots.character,
        gamesFromContext(context, ["genshin", "starrail"]),
      )
      const prefix = character.game === "starrail" ? "星铁" : ""
      const mode = slots.mode ? cleanEnum(slots.mode, ["最强", "最高分", "第一", "极限"]) : "最强"
      return `#${prefix}${mode === "极限" ? "" : "群内"}${mode}${character.character}`
    },
    validateCommand: /^#(星铁)?(群内)?(最强|最高分|第一|极限)[^#\n]{1,24}$/,
  }),
  commandFamily({
    id: "miao.group_rank_list",
    plugin: "miao",
    description: "查看群内角色面板排名或排行榜",
    intentExamples: ["看看群内胡桃排名", "星铁黄泉排行榜", "群内面板排行"],
    keywords: ["原神", "星铁", "群内", "角色", "面板", "排名", "排行", "排行榜"],
    runtimeAliases: MIAO_RUNTIME_ALIASES,
    games: ["genshin", "starrail"],
    slots: [
      { name: "game", required: false, description: "游戏；未说明时留空", allowedValues: ["原神", "星铁"] },
      { name: "topic", required: false, description: "角色或评分维度；留空查看面板排名" },
    ],
    commandExamples: ["#群内胡桃排名", "#星铁群内黄泉排行榜", "#群内面板排行"],
    build: slots => {
      const game = slots.game ? cleanEnum(slots.game, ["原神", "星铁"]) : ""
      const topic = slots.topic ? cleanEntity(slots.topic) : "面板"
      return `#${game}群内${topic}排名`
    },
    validateCommand: /^#(星铁|原神)?群内[^#\n]{1,24}(排名|排行)(榜)?$/,
  }),
  commandFamily({
    id: "miao.group_rank_reset",
    plugin: "miao",
    description: "重置当前群的全部或指定角色面板排名",
    intentExamples: ["重置群内排名", "重置胡桃排行榜"],
    keywords: ["喵喵", "群", "角色", "重置", "重设", "排名", "排行"],
    risk: "admin",
    runtimeAliases: MIAO_RUNTIME_ALIASES,
    games: ["genshin", "starrail"],
    slots: [
      { name: "game", required: false, description: "游戏；未说明时留空", allowedValues: ["原神", "星铁"] },
      { name: "topic", required: false, description: "角色名称；留空重置全部排名" },
    ],
    commandExamples: ["#重置排名", "#星铁重置黄泉排名"],
    build: slots => {
      const game = slots.game ? cleanEnum(slots.game, ["原神", "星铁"]) : ""
      const topic = slots.topic ? cleanEntity(slots.topic) : ""
      return `#${game}重置${topic}排名`
    },
    validateCommand: /^#(星铁|原神)?(重置|重设)[^#\n]{0,24}(排名|排行)$/,
  }),
  ...fixedCommandGroup(
    { plugin: "miao", risk: "admin", autoExecute: false, runtimeAliases: MIAO_RUNTIME_ALIASES, games: ["genshin", "starrail"] },
    [
      {
        id: "miao.group_rank_refresh",
        description: "刷新当前群的面板排名数据",
        command: "#刷新群内排名",
        intentExamples: ["刷新群面板排名", "重新加载群排行榜"],
        keywords: ["喵喵", "群内", "刷新", "更新", "重新加载", "排名"],
      },
      {
        id: "miao.group_rank_enable",
        description: "启用当前群的面板排名功能",
        command: "#启用群内排名",
        intentExamples: ["开启群面板排名"],
        keywords: ["喵喵", "群内", "开启", "打开", "启用", "排名"],
      },
      {
        id: "miao.group_rank_disable",
        description: "禁用当前群的面板排名功能",
        command: "#禁用群内排名",
        intentExamples: ["关闭群面板排名"],
        keywords: ["喵喵", "群内", "关闭", "禁用", "排名"],
      },
    ],
  ),
  commandFamily({
    id: "miao.artifact_list",
    plugin: "miao",
    description: "查看原神圣遗物或星铁遗器列表",
    intentExamples: ["看看我的圣遗物列表", "星铁遗器列表"],
    keywords: ["原神", "星铁", "圣遗物", "遗器", "列表", "面板"],
    runtimeAliases: MIAO_RUNTIME_ALIASES,
    games: ["genshin", "starrail"],
    slots: [{ name: "game", required: false, description: "游戏；未说明时使用原神", allowedValues: ["原神", "星铁"] }],
    commandExamples: ["#圣遗物列表", "#星铁遗器列表"],
    build: slots => {
      const game = slots.game ? cleanEnum(slots.game, ["原神", "星铁"]) : "原神"
      return game === "星铁" ? "#星铁遗器列表" : "#圣遗物列表"
    },
    validateCommand: /^#(原神)?圣遗物列表$|^#星铁遗器列表$/,
  }),
  commandFamily({
    id: "miao.theater_role_stats",
    plugin: "miao",
    description: "查看指定期数幻想真境剧诗的入门角色练度统计",
    intentExamples: ["查看 202407 幻想练度统计", "剧诗入门角色统计"],
    keywords: ["原神", "幻想真境剧诗", "剧诗", "期数", "入门角色", "练度", "统计"],
    runtimeAliases: MIAO_RUNTIME_ALIASES,
    games: ["genshin"],
    slots: [{ name: "period", required: true, description: "六位期数，例如 202407" }],
    commandExamples: ["#202407幻想真境剧诗练度统计"],
    build: slots => `#${cleanPatternValue(slots.period, /^202\d{3}$/, "期数必须是 202 开头的六位数字")}幻想真境剧诗练度统计`,
    validateCommand: /^#202\d{3}幻想真境剧诗练度统计$/,
  }),
  commandFamily({
    id: "miao.talent_refresh",
    plugin: "miao",
    description: "刷新原神天赋、技能或星铁行迹数据",
    intentExamples: ["更新所有角色天赋", "刷新星铁行迹", "强制更新技能"],
    keywords: ["原神", "星铁", "刷新", "更新", "强制", "所有角色", "天赋", "技能", "行迹"],
    risk: "write",
    runtimeAliases: MIAO_RUNTIME_ALIASES,
    games: ["genshin", "starrail"],
    slots: [
      { name: "game", required: false, description: "游戏；未说明时留空", allowedValues: ["原神", "星铁"] },
      { name: "force", required: false, description: "是否强制刷新", allowedValues: ["普通", "强制"] },
      { name: "scope", required: false, description: "刷新范围", allowedValues: ["", "所有", "角色"] },
      { name: "type", required: false, description: "天赋、技能或行迹", allowedValues: ["天赋", "技能", "行迹"] },
    ],
    commandExamples: ["#更新天赋", "#原神强制刷新所有天赋", "#星铁更新行迹"],
    build: slots => {
      const game = slots.game ? cleanEnum(slots.game, ["原神", "星铁"]) : ""
      const force = slots.force === "强制" ? "强制" : ""
      const scope = slots.scope ? cleanEnum(slots.scope, ["所有", "角色"]) : ""
      const type = slots.type ? cleanEnum(slots.type, ["天赋", "技能", "行迹"]) : game === "星铁" ? "行迹" : "天赋"
      return `#${game}${force}更新${scope}${type}`
    },
    validateCommand: /^#(星铁|原神)?(强制)?(刷新|更新)(所有|角色)?(天赋|技能|行迹)$/,
  }),
  commandFamily({
    id: "miao.enemy_level",
    plugin: "miao",
    description: "设置角色伤害计算使用的敌人等级",
    intentExamples: ["把敌人等级设为 100", "伤害计算用 95 级怪物"],
    keywords: ["喵喵", "伤害计算", "敌人", "怪物", "等级", "设置"],
    risk: "write",
    runtimeAliases: MIAO_RUNTIME_ALIASES,
    games: ["genshin", "starrail"],
    slots: [{ name: "level", required: true, description: "1 到 999 的敌人等级" }],
    commandExamples: ["#敌人等级100"],
    build: slots => `#敌人等级${cleanPatternValue(slots.level, /^\d{1,3}$/, "敌人等级必须是 1 到 3 位数字")}`,
    validateCommand: /^#(敌人|怪物)等级\s*\d{1,3}\s*$/,
  }),
  commandFamily({
    id: "miao.profile_refresh",
    plugin: "miao",
    description: "从游戏橱窗获取并更新原神或星铁角色面板",
    intentExamples: ["更新我的面板", "刷新全部原神面板", "获取星铁角色详情"],
    keywords: ["原神", "星铁", "角色", "全部", "面板", "橱窗", "获取", "刷新", "更新"],
    risk: "write",
    runtimeAliases: [...MIAO_RUNTIME_ALIASES, ...STARRAIL_RUNTIME_ALIASES],
    games: ["genshin", "starrail"],
    slots: [
      { name: "game", required: false, description: "游戏；未说明时留空", allowedValues: ["原神", "星铁"] },
      { name: "uid", required: false, description: "可选的游戏 UID" },
    ],
    commandExamples: ["#更新面板", "#原神更新全部面板", "#星铁更新面板"],
    build: slots => {
      const game = slots.game ? cleanEnum(slots.game, ["原神", "星铁"]) : ""
      const uid = cleanGameUid(slots.uid)
      return `#${game}更新面板${uid}`
    },
    validateCommand: /^#(星铁|原神)?(全部面板更新|更新全部面板|获取游戏角色详情|更新面板|面板更新)(?:\d{8,10})?$/,
  }),
  commandFamily({
    id: "miao.mys_profile_refresh",
    plugin: "miao",
    description: "通过米游社接口更新原神或星铁全部角色面板",
    intentExamples: ["用米游社更新面板", "mys 更新星铁全部面板"],
    keywords: ["原神", "星铁", "米游社", "MYS", "全部面板", "获取", "更新"],
    risk: "write",
    runtimeAliases: MIAO_RUNTIME_ALIASES,
    games: ["genshin", "starrail"],
    slots: [
      { name: "game", required: false, description: "游戏；未说明时留空", allowedValues: ["原神", "星铁"] },
      { name: "uid", required: false, description: "可选的游戏 UID" },
    ],
    commandExamples: ["#米游社更新面板", "#星铁mys更新全部面板"],
    build: slots => {
      const game = slots.game ? cleanEnum(slots.game, ["原神", "星铁"]) : ""
      return `#${game}米游社更新面板${cleanGameUid(slots.uid)}`
    },
    validateCommand: /^#(星铁|原神)?(米游社|mys)(全部面板更新|更新全部面板|获取游戏角色详情|更新面板|面板更新)(?:\d{8,10})?$/i,
  }),
  commandFamily({
    id: "miao.panel_image_upload",
    plugin: "miao",
    description: "上传指定角色的自定义面板图",
    intentExamples: ["上传胡桃面板图", "添加黄泉面板图片"],
    keywords: ["喵喵", "角色", "面板图", "上传", "添加", "图片"],
    risk: "admin",
    runtimeAliases: MIAO_RUNTIME_ALIASES,
    games: ["genshin", "starrail"],
    slots: [{ name: "character", required: true, description: "角色名称" }],
    commandExamples: ["#上传胡桃面板图"],
    build: slots => `#上传${cleanEntity(slots.character)}面板图`,
    validateCommand: /^#(上传|添加)[^#\n]{1,24}面板图$/,
  }),
  commandFamily({
    id: "miao.panel_image_delete",
    plugin: "miao",
    description: "删除指定角色的某张自定义面板图",
    intentExamples: ["删除胡桃第 1 张面板图"],
    keywords: ["喵喵", "角色", "面板图", "移除", "清除", "删除", "序号"],
    risk: "admin",
    runtimeAliases: MIAO_RUNTIME_ALIASES,
    games: ["genshin", "starrail"],
    slots: [
      { name: "character", required: true, description: "角色名称" },
      { name: "index", required: true, description: "面板图序号" },
    ],
    commandExamples: ["#删除胡桃面板图1"],
    build: slots => `#删除${cleanEntity(slots.character)}面板图${cleanPatternValue(slots.index, /^\d{1,3}$/, "序号必须是数字")}`,
    validateCommand: /^#删除[^#\n]{1,24}面板图\d{1,3}$/,
  }),
  commandFamily({
    id: "miao.panel_image_list",
    plugin: "miao",
    description: "查看指定角色的全部自定义面板图",
    intentExamples: ["看看胡桃面板图列表", "黄泉有哪些面板图"],
    keywords: ["喵喵", "角色", "面板图", "列表", "图片"],
    runtimeAliases: MIAO_RUNTIME_ALIASES,
    games: ["genshin", "starrail"],
    slots: [{ name: "character", required: true, description: "角色名称" }],
    commandExamples: ["#胡桃面板图列表"],
    build: slots => `#${cleanEntity(slots.character)}面板图列表`,
    validateCommand: /^#[^#\n]{1,24}面板图列表$/,
  }),
  commandFamily({
    id: "miao.profile_delete",
    plugin: "miao",
    description: "删除原神或星铁已保存的角色面板数据",
    intentExamples: ["删除我的面板数据", "清掉星铁全部面板"],
    keywords: ["原神", "星铁", "角色", "删除", "清除", "全部", "面板", "面板数据"],
    risk: "write",
    runtimeAliases: MIAO_RUNTIME_ALIASES,
    games: ["genshin", "starrail"],
    slots: [
      { name: "game", required: false, description: "游戏；未说明时留空", allowedValues: ["原神", "星铁"] },
      { name: "all", required: false, description: "删除全部面板时填写全部", allowedValues: ["当前", "全部"] },
      { name: "uid", required: false, description: "可选的游戏 UID" },
    ],
    commandExamples: ["#删除面板", "#星铁删除全部面板"],
    build: slots => {
      const game = slots.game ? cleanEnum(slots.game, ["原神", "星铁"]) : ""
      const action = slots.all === "全部" ? "删除全部面板" : "删除面板"
      return `#${game}${action}${cleanGameUid(slots.uid)}`
    },
    validateCommand: /^#(星铁|原神)?(删除全部面板|删除面板|删除面板数据)(?:\d{8,10})?$/,
  }),
  commandFamily({
    id: "miao.profile_reload",
    plugin: "miao",
    description: "从本地文件重新加载原神或星铁面板数据",
    intentExamples: ["重新加载面板", "重载星铁面板"],
    keywords: ["原神", "星铁", "加载", "重新加载", "重载", "面板"],
    risk: "admin",
    runtimeAliases: MIAO_RUNTIME_ALIASES,
    games: ["genshin", "starrail"],
    slots: [
      { name: "game", required: false, description: "游戏；未说明时留空", allowedValues: ["原神", "星铁"] },
      { name: "uid", required: false, description: "可选的游戏 UID" },
    ],
    commandExamples: ["#重新加载面板", "#星铁重载面板"],
    build: slots => {
      const game = slots.game ? cleanEnum(slots.game, ["原神", "星铁"]) : ""
      return `#${game}重新加载面板${cleanGameUid(slots.uid)}`
    },
    validateCommand: /^#(星铁|原神)?(加载|重新加载|重载)面板(?:\d{8,10})?$/,
  }),
  fixedCommand({
    id: "genshin.blueprint_help",
    plugin: "genshin",
    description: "查看尘歌壶模数养成计算说明",
    command: "#尘歌壶模数养成",
    intentExamples: ["尘歌壶模数怎么计算", "查看尘歌壶模数养成帮助"],
    keywords: ["原神", "尘歌壶", "模数", "养成", "计算", "帮助"],
    runtimeAliases: GENSHIN_RUNTIME_ALIASES,
    games: ["genshin"],
  }),
  commandFamily({
    id: "hoyo.news",
    plugin: "genshin",
    description: "查看米游社各游戏的公告、资讯、活动列表或指定序号内容",
    intentExamples: ["看看崩坏三公告列表", "未定事件簿第 2 条资讯", "官方活动列表"],
    keywords: ["米游社", "官方", "原神", "星铁", "绝区零", "崩坏三", "崩坏二", "未定事件簿", "公告", "资讯", "活动", "列表"],
    runtimeAliases: GENSHIN_RUNTIME_ALIASES,
    slots: [
      { name: "game", required: false, description: "游戏；未说明时使用官方", allowedValues: ["官方", "原神", "星铁", "绝区零", "崩坏三", "崩坏二", "未定事件簿"] },
      { name: "type", required: false, description: "公告、资讯或活动", allowedValues: ["公告", "资讯", "活动"] },
      { name: "item", required: false, description: "列表或数字序号；留空查看最新一条" },
    ],
    commandExamples: ["#官方公告列表", "#崩坏三资讯2", "#未定事件簿活动"],
    build: slots => {
      const game = slots.game ? cleanEnum(slots.game, ["官方", "原神", "星铁", "绝区零", "崩坏三", "崩坏二", "未定事件簿"]) : "官方"
      const type = slots.type ? cleanEnum(slots.type, ["公告", "资讯", "活动"]) : "公告"
      const item = slots.item ? cleanPatternValue(slots.item, /^(列表|\d{1,3})$/, "只能填写列表或数字序号") : ""
      return `#${game}${type}${item}`
    },
    validateCommand: /^#(官方|星铁|原神|崩坏三|绝区零|崩坏二|未定事件簿)?(公告|资讯|活动)(列表|\d{1,3})?$/,
  }),
  commandFamily({
    id: "hoyo.news_search",
    plugin: "genshin",
    description: "在米游社资讯中搜索指定主题",
    intentExamples: ["在米游社搜纳塔资讯", "搜索米游社黄泉公告"],
    keywords: ["米游社", "MYS", "搜索", "查询", "资讯", "公告", "文章"],
    runtimeAliases: GENSHIN_RUNTIME_ALIASES,
    slots: [{ name: "topic", required: true, description: "要搜索的主题" }],
    commandExamples: ["#米游社纳塔", "#mys黄泉"],
    build: slots => `#米游社${cleanEntity(slots.topic)}`,
    validateCommand: /^#(米游社|mys)[^#\r\n]{1,48}$/i,
  }),
  commandFamily({
    id: "hoyo.article_link",
    plugin: "genshin",
    description: "读取米游社原神文章链接内容",
    intentExamples: ["帮我读取这个米游社原神文章", "解析米游社文章链接"],
    keywords: ["米游社", "原神", "文章", "链接", "读取", "解析"],
    risk: "sensitive",
    runtimeAliases: GENSHIN_RUNTIME_ALIASES,
    games: ["genshin"],
    slots: [{ name: "url", required: true, description: "bbs.mihoyo.com 或 miyoushe.com 的原神文章链接" }],
    commandExamples: ["https://www.miyoushe.com/ys/article/1"],
    build: slots => cleanCommandArgument(slots.url, "米游社文章链接格式不正确", 180),
    validateCommand: /^https?:\/\/(?:[^\s/]+\.)?(?:bbs\.mihoyo\.com|miyoushe\.com)\/ys(?:\/.*)?\/article\/.*$/i,
  }),
  commandFamily({
    id: "hoyo.news_push_toggle",
    plugin: "genshin",
    description: "开启或关闭指定米游社游戏的公告或资讯推送",
    intentExamples: ["开启原神公告推送", "关闭星铁资讯推送"],
    keywords: ["米游社", "原神", "星铁", "绝区零", "崩坏", "未定事件簿", "开启", "关闭", "公告", "资讯", "推送"],
    risk: "admin",
    runtimeAliases: GENSHIN_RUNTIME_ALIASES,
    slots: [
      { name: "game", required: false, description: "游戏；留空表示默认", allowedValues: ["原神", "星铁", "绝区零", "崩坏三", "崩坏二", "未定事件簿"] },
      { name: "action", required: true, description: "开启或关闭", allowedValues: ["开启", "关闭"] },
      { name: "type", required: false, description: "公告或资讯", allowedValues: ["公告", "资讯"] },
    ],
    commandExamples: ["#原神开启公告推送", "#星铁关闭资讯推送"],
    build: slots => {
      const game = slots.game ? cleanEnum(slots.game, ["原神", "星铁", "绝区零", "崩坏三", "崩坏二", "未定事件簿"]) : ""
      return `#${game}${cleanEnum(slots.action, ["开启", "关闭"])}${slots.type ? cleanEnum(slots.type, ["公告", "资讯"]) : "公告"}推送`
    },
    validateCommand: /^#(星铁|原神|崩坏三|绝区零|崩坏二|未定事件簿)?(开启|关闭)(公告|资讯)推送$/,
  }),
  commandFamily({
    id: "hoyo.news_push_now",
    plugin: "genshin",
    description: "立即向当前群推送指定游戏的公告或资讯",
    intentExamples: ["现在推送原神公告", "推送星铁资讯"],
    keywords: ["米游社", "原神", "星铁", "绝区零", "崩坏", "未定事件簿", "立即", "推送", "公告", "资讯"],
    risk: "admin",
    runtimeAliases: GENSHIN_RUNTIME_ALIASES,
    slots: [
      { name: "game", required: false, description: "游戏；留空表示默认", allowedValues: ["原神", "星铁", "绝区零", "崩坏三", "崩坏二", "未定事件簿"] },
      { name: "type", required: false, description: "公告或资讯", allowedValues: ["公告", "资讯"] },
    ],
    commandExamples: ["#原神推送公告", "#星铁推送资讯"],
    build: slots => {
      const game = slots.game ? cleanEnum(slots.game, ["原神", "星铁", "绝区零", "崩坏三", "崩坏二", "未定事件簿"]) : ""
      return `#${game}推送${slots.type ? cleanEnum(slots.type, ["公告", "资讯"]) : "公告"}`
    },
    validateCommand: /^#(星铁|原神|崩坏三|绝区零|崩坏二|未定事件簿)?推送(公告|资讯)$/,
  }),
  commandFamily({
    id: "hoyo.expiring_event_push",
    plugin: "genshin",
    description: "开启或关闭原神、星铁到期活动预警推送",
    intentExamples: ["开启原神到期活动预警", "关闭星铁活动到期推送"],
    keywords: ["原神", "星铁", "到期", "活动", "预警", "开启", "关闭", "推送"],
    risk: "admin",
    runtimeAliases: GENSHIN_RUNTIME_ALIASES,
    games: ["genshin", "starrail"],
    slots: [
      { name: "game", required: true, description: "原神或星铁", allowedValues: ["原神", "星铁"] },
      { name: "action", required: true, description: "开启或关闭", allowedValues: ["开启", "关闭"] },
    ],
    commandExamples: ["#原神开启到期活动预警推送", "#星铁关闭到期活动推送"],
    build: slots => `#${cleanEnum(slots.game, ["原神", "星铁"])}${cleanEnum(slots.action, ["开启", "关闭"])}到期活动预警推送`,
    validateCommand: /^#(星铁|原神)(开启|关闭)到期活动(预警)?(推送)?$/,
  }),
  ...fixedCommandGroup(
    { plugin: "genshin", risk: "admin", autoExecute: false, runtimeAliases: GENSHIN_RUNTIME_ALIASES },
    [
      {
        id: "genshin.user_stats",
        description: "查看全部用户、Cookie 与 UID 统计",
        command: "#用户统计",
        intentExamples: ["查看 Yunzai 用户统计", "统计绑定 CK 和 UID 的用户"],
        keywords: ["主人", "用户", "Cookie", "CK", "UID", "统计"],
      },
      {
        id: "genshin.user_cache_refresh",
        description: "刷新或重置用户缓存、统计或 Cookie 状态",
        command: "#刷新用户缓存",
        intentExamples: ["刷新用户缓存", "重置用户统计"],
        keywords: ["主人", "刷新", "重置", "用户", "缓存", "统计", "CK"],
      },
      {
        id: "genshin.invalid_users_delete",
        description: "删除全部无效或失效用户 Cookie",
        command: "#删除失效用户",
        intentExamples: ["删除失效用户", "清理无效 CK"],
        keywords: ["主人", "删除", "清理", "无效", "失效", "用户", "CK"],
      },
      {
        id: "genshin.public_cookie_config",
        description: "配置公共查询 Cookie",
        command: "#配置公共查询cookie",
        intentExamples: ["配置公共查询 CK", "设置公共 Cookie"],
        keywords: ["主人", "配置", "公共", "查询", "Cookie", "CK"],
      },
      {
        id: "genshin.use_all_cookie",
        description: "切换为使用全部用户 Cookie",
        command: "#使用全部ck",
        intentExamples: ["使用全部 CK 做公共查询"],
        keywords: ["主人", "使用", "全部", "用户", "Cookie", "CK"],
      },
      {
        id: "genshin.use_user_cookie",
        description: "切换为仅使用用户 Cookie",
        command: "#使用用户ck",
        intentExamples: ["切换为用户 CK"],
        keywords: ["主人", "使用", "用户", "Cookie", "CK"],
      },
    ],
  ),
  commandFamily({
    id: "hoyo.redemption_codes",
    plugin: "genshin",
    description: "查看米哈游各游戏前瞻直播兑换码",
    intentExamples: ["看看崩坏三前瞻兑换码", "崩坏二直播兑换码"],
    keywords: ["原神", "星铁", "绝区零", "崩坏三", "崩坏二", "前瞻", "直播", "兑换码"],
    runtimeAliases: GENSHIN_RUNTIME_ALIASES,
    slots: [
      { name: "game", required: false, description: "游戏；未说明时使用原神", allowedValues: ["原神", "星铁", "绝区零", "崩坏三", "崩坏二"] },
      { name: "source", required: false, description: "直播或前瞻；可留空", allowedValues: ["直播", "前瞻"] },
    ],
    commandExamples: ["#崩坏三前瞻兑换码", "#崩坏二直播兑换码"],
    build: slots => `${slots.game ? `#${cleanEnum(slots.game, ["原神", "星铁", "绝区零", "崩坏三", "崩坏二"])}` : "#原神"}${slots.source ? cleanEnum(slots.source, ["直播", "前瞻"]) : ""}兑换码`,
    validateCommand: /^#(原神|星铁|崩坏三|崩坏二|绝区零)?(直播|前瞻)?兑换码$/,
  }),
  commandFamily({
    id: "genshin.ledger_month",
    plugin: "genshin",
    description: "查看指定月份的原石、札记或星琼记录",
    intentExamples: ["看看 3 月原石", "查询星铁五月星琼"],
    keywords: ["原神", "星铁", "原石", "札记", "星琼", "月份", "收入", "记录"],
    runtimeAliases: GENSHIN_RUNTIME_ALIASES,
    games: ["genshin", "starrail"],
    slots: [
      { name: "game", required: false, description: "游戏；未说明时原神", allowedValues: ["原神", "星铁"] },
      { name: "month", required: false, description: "1 到 12 月；留空查看本月" },
    ],
    commandExamples: ["#原石3月", "#星铁星琼五月"],
    build: slots => {
      const game = slots.game ? cleanEnum(slots.game, ["原神", "星铁"]) : "原神"
      const month = slots.month ? cleanPatternValue(slots.month, /^(?:[1-9]|1[0-2]|[一二三四五六七八九十]+)月?$/, "月份格式不正确") : ""
      return `#${game === "星铁" ? "星铁星琼" : "原石"}${month}`
    },
    validateCommand: /^#(?:原石|星铁星琼)(?:[0-9一二两三四五六七八九十]+月?)?$/,
  }),
  commandFamily({
    id: "genshin.ledger_task",
    plugin: "genshin",
    description: "主人手动执行原石或星琼札记定时任务",
    intentExamples: ["执行原石札记任务", "手动运行星铁星琼任务"],
    keywords: ["主人", "原神", "星铁", "原石", "星琼", "札记", "任务", "执行"],
    risk: "admin",
    autoExecute: false,
    runtimeAliases: GENSHIN_RUNTIME_ALIASES,
    games: ["genshin", "starrail"],
    slots: [{ name: "game", required: false, description: "原神或星铁", allowedValues: ["原神", "星铁"] }],
    commandExamples: ["#原石任务", "#星铁星琼任务"],
    build: slots => `#${slots.game === "星铁" ? "星铁星琼" : "原石"}任务`,
    validateCommand: /^#(原石|星铁星琼)任务$/,
  }),
  commandFamily({
    id: "genshin.guide_refresh",
    plugin: "genshin",
    description: "更新指定原神角色的攻略图缓存",
    intentExamples: ["更新胡桃攻略", "刷新桑多涅攻略 2"],
    keywords: ["原神", "角色", "攻略", "攻略图", "更新", "刷新", "缓存"],
    risk: "write",
    runtimeAliases: GENSHIN_RUNTIME_ALIASES,
    games: ["genshin"],
    characterSlot: "character",
    slots: [
      { name: "character", required: true, description: "原神角色" },
      { name: "source", required: false, description: "攻略来源编号 1 到 7", allowedValues: ["1", "2", "3", "4", "5", "6", "7"] },
    ],
    commandExamples: ["#更新胡桃攻略", "#更新桑多涅攻略2"],
    build: slots => {
      const character = resolveWhitelistedCharacter(slots.character, ["genshin"])
      return `#更新${character.character}攻略${slots.source ? cleanEnum(slots.source, ["1", "2", "3", "4", "5", "6", "7"]) : ""}`
    },
    validateCommand: /^#更新[^#\s\n]{1,24}攻略[1-7]?$/,
  }),
  commandFamily({
    id: "genshin.guide_default_source",
    plugin: "genshin",
    description: "设置原神攻略图的默认来源编号",
    intentExamples: ["把默认攻略来源设为 3", "设置默认攻略"],
    keywords: ["主人", "原神", "攻略", "默认", "来源", "设置", "编号"],
    risk: "admin",
    runtimeAliases: GENSHIN_RUNTIME_ALIASES,
    games: ["genshin"],
    slots: [{ name: "source", required: false, description: "来源编号 1 到 7；留空查看或重置", allowedValues: ["1", "2", "3", "4", "5", "6", "7"] }],
    commandExamples: ["#设置默认攻略", "#设置默认攻略3"],
    build: slots => `#设置默认攻略${slots.source ? cleanEnum(slots.source, ["1", "2", "3", "4", "5", "6", "7"]) : ""}`,
    validateCommand: /^#设置默认攻略[1-7]?$/,
  }),
  commandFamily({
    id: "genshin.alias_set",
    plugin: "genshin",
    description: "进入原神或星铁角色别名设置流程",
    intentExamples: ["给纳西妲设置别名", "配置黄泉昵称"],
    keywords: ["原神", "星铁", "角色", "设置", "配置", "别名", "昵称"],
    risk: "admin",
    runtimeAliases: GENSHIN_RUNTIME_ALIASES,
    games: ["genshin", "starrail"],
    slots: [
      { name: "game", required: false, description: "游戏；未说明时原神", allowedValues: ["原神", "星铁"] },
      { name: "character", required: true, description: "角色名称" },
    ],
    commandExamples: ["#设置纳西妲别名", "#星铁设置黄泉昵称"],
    build: slots => `#${slots.game === "星铁" ? "星铁" : ""}设置${cleanEntity(slots.character)}别名`,
    validateCommand: /^#(星铁)?(设置|配置)[^#\r\n]{1,48}(别名|昵称)$/,
  }),
  commandFamily({
    id: "genshin.alias_delete",
    plugin: "genshin",
    description: "删除原神或星铁角色别名或昵称",
    intentExamples: ["删除别名草神", "删掉星铁昵称泉姐"],
    keywords: ["原神", "星铁", "角色", "删除", "别名", "昵称"],
    risk: "admin",
    runtimeAliases: GENSHIN_RUNTIME_ALIASES,
    games: ["genshin", "starrail"],
    slots: [
      { name: "game", required: false, description: "游戏；未说明时原神", allowedValues: ["原神", "星铁"] },
      { name: "alias", required: true, description: "要删除的别名" },
    ],
    commandExamples: ["#删除别名草神", "#星铁删除昵称泉姐"],
    build: slots => `#${slots.game === "星铁" ? "星铁" : ""}删除别名${cleanEntity(slots.alias)}`,
    validateCommand: /^#(星铁)?删除(别名|昵称)[^#\r\n]{1,48}$/,
  }),
  commandFamily({
    id: "genshin.alias_lookup",
    plugin: "genshin",
    description: "查看原神或星铁角色的全部别名或昵称",
    intentExamples: ["胡桃有哪些别名", "看看黄泉昵称"],
    keywords: ["原神", "星铁", "角色", "查看", "别名", "昵称", "列表"],
    runtimeAliases: GENSHIN_RUNTIME_ALIASES,
    games: ["genshin", "starrail"],
    slots: [
      { name: "game", required: false, description: "游戏；未说明时原神", allowedValues: ["原神", "星铁"] },
      { name: "character", required: true, description: "角色名称或别名" },
    ],
    commandExamples: ["#胡桃别名", "#星铁黄泉昵称"],
    build: slots => `#${slots.game === "星铁" ? "星铁" : ""}${cleanEntity(slots.character)}别名`,
    validateCommand: /^#(星铁)?[^#\r\n]{1,48}(别名|昵称)$/,
  }),
  commandFamily({
    id: "genshin.weapon_list_filtered",
    plugin: "genshin",
    description: "按四星或五星筛选原神账号武器列表",
    intentExamples: ["看看我的五星武器", "列出四星武器"],
    keywords: ["原神", "四星", "五星", "武器", "列表", "账号"],
    runtimeAliases: GENSHIN_RUNTIME_ALIASES,
    games: ["genshin"],
    slots: [{ name: "rarity", required: false, description: "四星或五星；留空查看全部", allowedValues: ["四星", "五星"] }],
    commandExamples: ["#五星武器", "#四星武器"],
    build: slots => `#${slots.rarity ? cleanEnum(slots.rarity, ["四星", "五星"]) : ""}武器`,
    validateCommand: /^#(四星|五星)?武器$/,
  }),
  commandFamily({
    id: "genshin.exploration_category",
    plugin: "genshin",
    description: "查看原神宝箱、成就、尘歌壶、家园、探索或声望进度",
    intentExamples: ["看看我的宝箱", "查询原神成就", "查看声望进度"],
    keywords: ["原神", "宝箱", "成就", "尘歌壶", "家园", "探索", "探险", "声望", "进度"],
    runtimeAliases: GENSHIN_RUNTIME_ALIASES,
    games: ["genshin"],
    slots: [{ name: "category", required: true, description: "要查看的项目", allowedValues: ["宝箱", "成就", "尘歌壶", "家园", "探索", "探险", "声望", "探险度", "探索度"] }],
    commandExamples: ["#宝箱", "#成就", "#声望"],
    build: slots => `#${cleanEnum(slots.category, ["宝箱", "成就", "尘歌壶", "家园", "探索", "探险", "声望", "探险度", "探索度"])}`,
    validateCommand: /^#(宝箱|成就|尘歌壶|家园|探索|探险|声望|探险度|探索度)$/,
  }),
  ...fixedCommandGroup(
    { plugin: "genshin", risk: "sensitive", autoExecute: false, runtimeAliases: GENSHIN_RUNTIME_ALIASES },
    [
      {
        id: "genshin.payment_records",
        description: "查看米哈游充值或消费记录与统计",
        command: "#充值记录",
        intentExamples: ["查看我的充值记录", "统计原神消费"],
        keywords: ["原神", "米哈游", "充值", "消费", "记录", "统计"],
      },
      {
        id: "genshin.payment_records_update",
        description: "更新米哈游充值或消费记录",
        command: "#更新充值记录",
        intentExamples: ["更新我的充值记录", "刷新消费统计"],
        keywords: ["原神", "米哈游", "更新", "刷新", "充值", "消费", "记录"],
      },
      {
        id: "genshin.payment_help",
        description: "查看充值与消费记录获取帮助",
        command: "#充值记录帮助",
        intentExamples: ["充值记录怎么查", "查看消费统计帮助"],
        keywords: ["原神", "充值", "消费", "记录", "统计", "帮助"],
      },
      {
        id: "genshin.cookie_code",
        description: "查看 Cookie 获取脚本代码",
        command: "#ck代码",
        intentExamples: ["给我 CK 获取代码", "查看 Cookie 代码"],
        keywords: ["原神", "Cookie", "CK", "代码", "获取"],
      },
      {
        id: "genshin.cookie_bind",
        description: "进入米游社 Cookie 绑定流程",
        command: "#绑定cookie",
        intentExamples: ["绑定米游社 Cookie", "开始绑定 CK"],
        keywords: ["原神", "米游社", "Cookie", "CK", "绑定"],
      },
      {
        id: "genshin.cookie_show",
        description: "查看已绑定的米游社 Cookie",
        command: "#我的cookie",
        intentExamples: ["查看我的 Cookie", "显示已绑定 CK"],
        keywords: ["原神", "星铁", "绝区零", "米游社", "我的", "Cookie", "CK", "查看"],
      },
      {
        id: "genshin.cookie_delete",
        description: "删除已绑定的米游社 Cookie",
        command: "#删除cookie",
        intentExamples: ["删除我的 Cookie", "解绑米游社 CK"],
        keywords: ["原神", "星铁", "绝区零", "米游社", "删除", "解绑", "Cookie", "CK"],
      },
      {
        id: "genshin.cookie_status",
        description: "检查已绑定米游社 Cookie 的状态",
        command: "#检查cookie状态",
        intentExamples: ["检查我的 CK 状态", "Cookie 还有效吗"],
        keywords: ["原神", "米游社", "检查", "我的", "Cookie", "CK", "状态", "有效"],
      },
    ],
  ),
  commandFamily({
    id: "genshin.payment_link",
    plugin: "genshin",
    description: "读取米哈游充值或消费记录页面链接",
    intentExamples: ["从这个米哈游账单链接导入充值记录"],
    keywords: ["米哈游", "充值", "消费", "账单", "记录", "链接", "导入"],
    risk: "sensitive",
    runtimeAliases: GENSHIN_RUNTIME_ALIASES,
    slots: [{ name: "url", required: true, description: "米哈游账单或充值记录链接" }],
    commandExamples: ["https://example.invalid/user-game-search"],
    build: slots => cleanCommandArgument(slots.url, "账单链接格式不正确", 180),
    validateCommand: /^https?:\/\/[^\r\n]*(user-game-search|bill-record-user|customer-claim|player-log|user\.mihoyo\.com)[^\r\n]*$/i,
  }),
  commandFamily({
    id: "genshin.cookie_payload",
    plugin: "genshin",
    description: "直接提交包含 ltoken 与 ltuid 的米游社 Cookie 进行绑定",
    intentExamples: ["直接提交米游社 Cookie 绑定"],
    keywords: ["原神", "米游社", "Cookie", "ltoken", "ltuid", "login_uid", "绑定"],
    risk: "sensitive",
    runtimeAliases: GENSHIN_RUNTIME_ALIASES,
    runtimeRuleOptional: true,
    slots: [{ name: "cookie", required: true, description: "完整米游社 Cookie，仅允许在私聊中使用" }],
    commandExamples: ["ltoken=REDACTED;ltuid=100000001;"],
    build: slots => cleanCommandArgument(slots.cookie, "Cookie 格式不正确", 190),
    validateCommand: /^(?=[^\r\n]*(?:ltoken|ltoken_v2))(?=[^\r\n]*(?:ltuid|login_uid|ltmid_v2))[^\r\n]{10,190}$/i,
  }),
  commandFamily({
    id: "genshin.mhyuuid_payload",
    plugin: "genshin",
    description: "提交包含 _MHYUUID 的米游社登录响应以继续 Cookie 绑定",
    intentExamples: ["提交米游社 _MHYUUID 登录响应"],
    keywords: ["原神", "米游社", "MHYUUID", "登录", "Cookie", "绑定"],
    risk: "sensitive",
    runtimeAliases: GENSHIN_RUNTIME_ALIASES,
    slots: [{ name: "payload", required: true, description: "包含 _MHYUUID 的完整登录响应" }],
    commandExamples: ["_MHYUUID=REDACTED"],
    build: slots => cleanCommandArgument(slots.payload, "_MHYUUID 响应格式不正确", 190),
    validateCommand: /^(?=[^\r\n]*_MHYUUID)[^\r\n]{10,190}$/,
  }),
  commandFamily({
    id: "genshin.uid_delete",
    plugin: "genshin",
    description: "删除或解绑原神、星铁或绝区零 UID",
    intentExamples: ["解绑原神 UID", "删除第 2 个星铁 UID"],
    keywords: ["原神", "星铁", "绝区零", "删除", "解绑", "UID", "游戏账号"],
    risk: "write",
    runtimeAliases: GENSHIN_RUNTIME_ALIASES,
    games: ["genshin", "starrail", "zzz"],
    slots: [
      { name: "game", required: false, description: "游戏；未说明时原神", allowedValues: ["原神", "星铁", "绝区零"] },
      { name: "index", required: false, description: "可选的 UID 序号 1 到 99" },
    ],
    commandExamples: ["#删除uid", "#星铁解绑uid2"],
    build: slots => {
      const game = slots.game ? cleanEnum(slots.game, ["原神", "星铁", "绝区零"]) : ""
      const index = slots.index ? cleanPatternValue(slots.index, /^(?:[1-9]|[1-9]\d)$/, "UID 序号必须是 1 到 99") : ""
      return `#${game}删除uid${index}`
    },
    validateCommand: /^#(原神|星铁|绝区零)?(删除|解绑)uid(?:[1-9]\d?)?$/i,
  }),
  commandFamily({
    id: "genshin.linked_account_bind",
    plugin: "genshin",
    description: "接受并绑定主用户或子用户账号关系",
    intentExamples: ["绑定主用户", "接受绑定子账号"],
    keywords: ["原神", "接受", "绑定", "主用户", "子用户", "账户", "账号"],
    risk: "write",
    runtimeAliases: GENSHIN_RUNTIME_ALIASES,
    slots: [
      { name: "accept", required: false, description: "是否接受绑定", allowedValues: ["直接", "接受"] },
      { name: "role", required: false, description: "主或子；可留空", allowedValues: ["主", "子"] },
    ],
    commandExamples: ["#绑定主用户", "#接受绑定子账号"],
    build: slots => `#${slots.accept === "接受" ? "接受" : ""}绑定${slots.role ? cleanEnum(slots.role, ["主", "子"]) : ""}用户`,
    validateCommand: /^#(接受)?绑定(主|子)?(用户|账户|账号)$/,
  }),
  commandFamily({
    id: "genshin.linked_account_unbind",
    plugin: "genshin",
    description: "取消或删除主用户、子用户账号绑定关系",
    intentExamples: ["解绑主用户", "取消绑定子账号"],
    keywords: ["原神", "删除", "取消", "解除", "解绑", "主用户", "子用户", "账户", "账号"],
    risk: "write",
    runtimeAliases: GENSHIN_RUNTIME_ALIASES,
    slots: [{ name: "role", required: true, description: "主或子", allowedValues: ["主", "子"] }],
    commandExamples: ["#解绑主用户", "#取消绑定子账号"],
    build: slots => `#解绑${cleanEnum(slots.role, ["主", "子"])}用户`,
    validateCommand: /^#(删除绑定|取消绑定|解除绑定|解绑|删除|取消)(主|子)(用户|账户|账号)$/,
  }),
  commandFamily({
    id: "genshin.gacha_authkey_link",
    plugin: "genshin",
    description: "从包含 authkey 的原神或星铁链接导入抽卡记录",
    intentExamples: ["用 authkey 链接导入抽卡记录"],
    keywords: ["原神", "星铁", "抽卡", "跃迁", "authkey", "链接", "导入", "记录"],
    risk: "sensitive",
    runtimeAliases: GENSHIN_RUNTIME_ALIASES,
    slots: [{ name: "url", required: true, description: "包含 authkey 的完整抽卡记录链接" }],
    commandExamples: ["https://example.invalid/?authkey=REDACTED"],
    build: slots => cleanCommandArgument(slots.url, "抽卡链接格式不正确", 190),
    validateCommand: /^(?=[^\r\n]*authkey=)[^\r\n]{12,190}$/i,
  }),
  commandFamily({
    id: "genshin.gacha_import_options",
    plugin: "genshin",
    description: "按游戏与强制选项导入抽卡 JSON 记录",
    intentExamples: ["强制导入星铁记录 JSON", "导入原神祈愿记录"],
    keywords: ["原神", "星铁", "强制", "导入", "抽卡", "跃迁", "JSON", "记录"],
    risk: "sensitive",
    runtimeAliases: GENSHIN_RUNTIME_ALIASES,
    games: ["genshin", "starrail"],
    slots: [
      { name: "game", required: false, description: "原神或星铁；未说明时原神", allowedValues: ["原神", "星铁"] },
      { name: "force", required: false, description: "普通或强制", allowedValues: ["普通", "强制"] },
    ],
    commandExamples: ["#星铁强制导入记录json", "#原神导入记录"],
    build: slots => `#${slots.game ? cleanEnum(slots.game, ["原神", "星铁"]) : ""}${slots.force === "强制" ? "强制" : ""}导入记录json`,
    validateCommand: /^#(原神|星铁)?(强制)?导入记录(json)?$/i,
  }),
  commandFamily({
    id: "genshin.gacha_export_options",
    plugin: "genshin",
    description: "按游戏、强制选项与 UIGF 版本导出抽卡记录",
    intentExamples: ["强制导出星铁记录 v4", "导出原神抽卡 JSON v2"],
    keywords: ["原神", "星铁", "强制", "导出", "抽卡", "跃迁", "JSON", "UIGF", "v2", "v4"],
    risk: "sensitive",
    runtimeAliases: GENSHIN_RUNTIME_ALIASES,
    games: ["genshin", "starrail"],
    slots: [
      { name: "game", required: false, description: "原神或星铁；未说明时原神", allowedValues: ["原神", "星铁"] },
      { name: "force", required: false, description: "普通或强制", allowedValues: ["普通", "强制"] },
      { name: "version", required: false, description: "UIGF v2 或 v4", allowedValues: ["v2", "v4"] },
    ],
    commandExamples: ["#星铁强制导出记录jsonv4", "#原神导出记录jsonv2"],
    build: slots => `#${slots.game ? cleanEnum(slots.game, ["原神", "星铁"]) : ""}${slots.force === "强制" ? "强制" : ""}导出记录json${slots.version ? cleanEnum(slots.version, ["v2", "v4"]) : ""}`,
    validateCommand: /^#(原神|星铁)?(强制)?导出记录(json)?(v2|v4)?$/i,
  }),
  commandFamily({
    id: "genshin.gacha_full_update_setting",
    plugin: "genshin",
    description: "设置是否全量更新或获取抽卡祈愿记录",
    intentExamples: ["开启全量更新抽卡记录", "关闭全量获取祈愿记录"],
    keywords: ["主人", "原神", "星铁", "设置", "全量", "更新", "获取", "抽卡", "祈愿", "记录", "开关"],
    risk: "admin",
    runtimeAliases: GENSHIN_RUNTIME_ALIASES,
    slots: [{ name: "action", required: false, description: "开或关；留空查看当前设置", allowedValues: ["开", "关"] }],
    commandExamples: ["#设置全量更新抽卡记录开", "#设置全量获取祈愿记录关"],
    build: slots => `#设置全量更新抽卡记录${slots.action ? cleanEnum(slots.action, ["开", "关"]) : ""}`,
    validateCommand: /^#设置全量(更新|获取)(抽卡|祈愿)记录\s*(开|关|on|off)?$/i,
  }),
  commandFamily({
    id: "starrail.reference_panel",
    plugin: "starrail",
    description: "查看指定星铁角色的参考面板",
    intentExamples: ["看看黄泉参考面板", "流萤毕业面板参考"],
    keywords: ["星铁", "星穹铁道", "角色", "参考面板", "毕业面板", "属性"],
    runtimeAliases: STARRAIL_RUNTIME_ALIASES,
    games: ["starrail"],
    characterSlot: "character",
    slots: [{ name: "character", required: true, description: "星铁角色名称或常用别名" }],
    commandExamples: ["*黄泉参考面板", "*流萤参考面板"],
    build: slots => `*${resolveWhitelistedCharacter(slots.character, ["starrail"]).character}参考面板`,
    validateCommand: /^\*[^*#\r\n]{1,24}参考面板$/,
  }),
  ...fixedCommandGroup(
    { plugin: "starrail", runtimeAliases: STARRAIL_RUNTIME_ALIASES, games: ["starrail"] },
    [
      {
        id: "starrail.reference_panel_help",
        description: "查看星铁角色参考面板说明",
        command: "*参考面板帮助",
        intentExamples: ["参考面板怎么看", "星铁参考面板帮助"],
        keywords: ["星铁", "角色", "参考面板", "帮助", "说明"],
      },
      {
        id: "starrail.return_curve",
        description: "查看星铁角色各属性收益曲线",
        command: "*收益曲线",
        intentExamples: ["看看星铁收益曲线", "各属性收益如何"],
        keywords: ["星铁", "角色", "属性", "收益曲线", "收益", "曲线"],
      },
      {
        id: "starrail.strategy_overview",
        description: "查看星铁全角色攻略总览",
        command: "*攻略",
        intentExamples: ["打开星铁攻略总览", "查看全部角色攻略"],
        keywords: ["星铁", "全角色", "攻略", "总览", "列表"],
      },
      {
        id: "starrail.resource_estimate",
        description: "查看星铁当前或下版本星琼资源预估",
        command: "*预估",
        intentExamples: ["星铁这版本有多少星琼", "下版本星琼预估"],
        keywords: ["星铁", "版本", "星琼", "资源", "预估", "盘点"],
      },
      {
        id: "starrail.abyss_guide",
        description: "查看星铁深渊或忘却之庭阵容攻略",
        command: "*深渊攻略",
        intentExamples: ["星铁深渊怎么配队", "忘却之庭攻略"],
        keywords: ["星铁", "深渊", "忘却之庭", "阵容", "配队", "攻略"],
      },
      {
        id: "starrail.shop_lightcone_recommendation",
        description: "查看星铁跃迁商店光锥兑换推荐",
        command: "*商店光锥推荐",
        intentExamples: ["星铁商店换什么光锥", "商店光锥推荐"],
        keywords: ["星铁", "跃迁商店", "商店", "光锥", "兑换", "推荐"],
      },
      {
        id: "starrail.api_list",
        description: "查看星铁面板 API 服务列表",
        command: "*API列表",
        intentExamples: ["查看星铁面板 API 列表"],
        keywords: ["星铁", "面板", "API", "接口", "列表"],
      },
      {
        id: "starrail.update_log",
        description: "查看星铁插件更新日志",
        command: "*更新日志",
        intentExamples: ["星铁插件最近更新了什么", "查看星铁更新日志"],
        keywords: ["星铁", "插件", "更新日志", "版本", "改动"],
      },
    ],
  ),
  commandFamily({
    id: "starrail.challenge",
    plugin: "starrail",
    description: "查看指定期数的忘却、虚构、末日、仲裁或深渊挑战数据",
    intentExamples: ["看看上期忘却之庭", "本期简易虚构", "往期异相仲裁", "当期深渊"],
    keywords: ["星铁", "上期", "本期", "最新", "当期", "简易", "深渊", "忘却", "混沌", "虚构", "末日", "仲裁", "战绩"],
    runtimeAliases: STARRAIL_RUNTIME_ALIASES,
    games: ["starrail"],
    slots: [
      { name: "period", required: false, description: "往期、上期、本期、最新或当期", allowedValues: ["往期", "上期", "本期", "最新", "当期"] },
      { name: "simple", required: false, description: "普通或简易", allowedValues: ["普通", "简易"] },
      { name: "mode", required: true, description: "挑战类型", allowedValues: ["深渊", "忘却", "忘却之庭", "混沌", "混沌回忆", "虚构", "虚构叙事", "末日", "末日幻影", "异相", "仲裁", "异相仲裁"] },
    ],
    commandExamples: ["*上期忘却", "*本期简易虚构", "*往期异相仲裁", "*当期深渊"],
    build: slots => {
      const period = slots.period ? cleanEnum(slots.period, ["往期", "上期", "本期", "最新", "当期"]) : ""
      const simple = slots.simple === "简易" ? "简易" : ""
      const mode = cleanEnum(slots.mode, ["深渊", "忘却", "忘却之庭", "混沌", "混沌回忆", "虚构", "虚构叙事", "末日", "末日幻影", "异相", "仲裁", "异相仲裁"])
      if (["最新", "当期"].includes(period) && mode !== "深渊") {
        throw new Error("最新或当期前缀只适用于深渊总览")
      }
      if (period === "往期" && !["异相", "仲裁", "异相仲裁"].includes(mode)) {
        throw new Error("往期前缀只适用于异相仲裁")
      }
      return `*${period}${simple}${mode}`
    },
    validateCommand: /^\*(?:(最新|当期)(简易)?深渊|(上期|本期)?(简易)?(深渊|忘却|忘却之庭|混沌|混沌回忆|虚构|虚构叙事|末日|末日幻影)|(往期|上期|本期)?(简易)?(异相|仲裁|异相仲裁))$/,
  }),
  commandFamily({
    id: "starrail.gacha_link",
    plugin: "starrail",
    description: "进入星铁抽卡链接绑定流程",
    intentExamples: ["绑定星铁抽卡链接", "设置跃迁记录链接"],
    keywords: ["星铁", "跃迁", "抽卡", "链接", "绑定", "记录"],
    risk: "sensitive",
    runtimeAliases: STARRAIL_RUNTIME_ALIASES,
    games: ["starrail"],
    slots: [{ name: "bind", required: false, description: "查看或绑定", allowedValues: ["查看", "绑定"] }],
    commandExamples: ["*抽卡链接", "*抽卡链接绑定"],
    build: slots => `*抽卡链接${slots.bind === "绑定" ? "绑定" : ""}`,
    validateCommand: /^\*抽卡链接(绑定)?$/,
  }),
  fixedCommand({
    id: "starrail.gacha_update",
    plugin: "starrail",
    description: "获取并更新星铁抽卡或跃迁记录",
    command: "*更新抽卡记录",
    intentExamples: ["更新我的星铁抽卡记录", "同步最新跃迁记录", "拉取星铁抽卡数据"],
    keywords: ["星铁", "星穹铁道", "更新", "同步", "抽卡", "跃迁", "记录"],
    risk: "write",
    autoExecute: false,
    runtimeAliases: STARRAIL_RUNTIME_ALIASES,
    games: ["starrail"],
  }),
  commandFamily({
    id: "starrail.gacha_simulation",
    plugin: "starrail",
    description: "执行星铁角色、光锥或常驻模拟抽卡",
    intentExamples: ["来一次星铁十连", "模拟抽光锥", "常驻池十连"],
    keywords: ["星铁", "模拟", "抽卡", "十连", "角色", "光锥", "常驻"],
    risk: "write",
    runtimeAliases: STARRAIL_RUNTIME_ALIASES,
    games: ["starrail"],
    slots: [{ name: "pool", required: false, description: "角色、光锥或常驻；未说明时默认池", allowedValues: ["角色", "光锥", "常驻"] }],
    commandExamples: ["*十连", "*抽卡角色", "*十连光锥"],
    build: slots => `*十连${slots.pool ? cleanEnum(slots.pool, ["角色", "光锥", "常驻"]) : ""}`,
    validateCommand: /^\*(抽卡|十连)(角色|光锥|常驻)?$/,
  }),
  commandFamily({
    id: "starrail.account_card",
    plugin: "starrail",
    description: "查看星铁账号卡片、探索或角色信息",
    intentExamples: ["看看星铁探索", "查看星铁角色信息"],
    keywords: ["星铁", "账号", "卡片", "探索", "角色", "信息"],
    runtimeAliases: STARRAIL_RUNTIME_ALIASES,
    games: ["starrail"],
    slots: [{ name: "view", required: false, description: "卡片、探索或角色", allowedValues: ["卡片", "探索", "角色"] }],
    commandExamples: ["*卡片", "*探索", "*角色"],
    build: slots => `*${slots.view ? cleanEnum(slots.view, ["卡片", "探索", "角色"]) : "卡片"}`,
    validateCommand: /^\*(卡片|探索|角色)$/,
  }),
  commandFamily({
    id: "starrail.account_records",
    plugin: "starrail",
    description: "查看星铁星琼、梦华、体力、遗器、光锥、充值或武器记录",
    intentExamples: ["看看星琼记录", "查询遗器记录 2", "查看充值记录"],
    keywords: ["星铁", "星琼", "古老梦华", "体力", "遗器", "光锥", "充值", "武器", "记录"],
    risk: "sensitive",
    runtimeAliases: STARRAIL_RUNTIME_ALIASES,
    games: ["starrail"],
    slots: [
      { name: "type", required: true, description: "记录类型", allowedValues: ["星琼", "古老梦华", "体力", "遗器", "光锥", "充值", "武器"] },
      { name: "index", required: false, description: "可选的数字页码或序号" },
    ],
    commandExamples: ["*星琼记录", "*遗器记录2", "*充值记录"],
    build: slots => `*${cleanEnum(slots.type, ["星琼", "古老梦华", "体力", "遗器", "光锥", "充值", "武器"])}记录${slots.index ? cleanPatternValue(slots.index, /^\d{1,4}$/, "序号必须是数字") : ""}`,
    validateCommand: /^\*(星琼|古老梦华|体力|遗器|光锥|充值|武器)记录\d*$/,
  }),
  commandFamily({
    id: "starrail.panel_plugin_toggle",
    plugin: "starrail",
    description: "开启、关闭或查看喵喵与星铁插件面板处理器状态",
    intentExamples: ["关闭星铁插件面板", "查看插件面板状态", "开启喵喵插件面板"],
    keywords: ["主人", "星铁", "喵喵", "插件", "面板", "开启", "关闭", "状态"],
    risk: "admin",
    runtimeAliases: STARRAIL_RUNTIME_ALIASES,
    games: ["starrail"],
    slots: [
      { name: "plugin", required: false, description: "喵喵或星铁；留空查看统一状态", allowedValues: ["喵喵", "星铁"] },
      { name: "action", required: true, description: "开启、关闭或状态", allowedValues: ["开启", "关闭", "状态"] },
    ],
    commandExamples: ["#星铁插件面板关闭", "#喵喵插件面板开启", "#插件面板状态"],
    build: slots => `#${slots.plugin ? cleanEnum(slots.plugin, ["喵喵", "星铁"]) : ""}插件面板${cleanEnum(slots.action, ["开启", "关闭", "状态"])}`,
    validateCommand: /^#(喵喵|星铁)?插件面板(开启|关闭|状态)$/,
  }),
  commandFamily({
    id: "starrail.panel_api_select",
    plugin: "starrail",
    description: "设置或切换星铁面板 API 服务",
    intentExamples: ["切换星铁面板 API", "设置面板接口 2"],
    keywords: ["主人", "星铁", "面板", "API", "接口", "设置", "切换"],
    risk: "admin",
    runtimeAliases: STARRAIL_RUNTIME_ALIASES,
    games: ["starrail"],
    slots: [{ name: "value", required: false, description: "可选的 API 编号或名称" }],
    commandExamples: ["*切换面板API", "*设置面板api2"],
    build: slots => `*切换面板API${slots.value ? cleanEntity(slots.value) : ""}`,
    validateCommand: /^\*(设置|切换)面板(API|api)?[^*#\r\n]{0,24}$/,
  }),
  commandFamily({
    id: "starrail.alias_set",
    plugin: "starrail",
    description: "为星铁角色设置、配置或添加别名昵称",
    intentExamples: ["给黄泉添加别名泉姐", "设置流萤昵称"],
    keywords: ["星铁", "角色", "设置", "配置", "添加", "别名", "昵称"],
    risk: "admin",
    runtimeAliases: STARRAIL_RUNTIME_ALIASES,
    games: ["starrail"],
    slots: [{ name: "character", required: true, description: "要进入别名设置的星铁角色" }],
    commandExamples: ["*设置黄泉别名", "*添加流萤昵称"],
    build: slots => `*设置${cleanEntity(slots.character)}别名`,
    validateCommand: /^\*(设置|配置|添加)[^*#\r\n]{1,48}(别名|昵称)$/,
  }),
  commandFamily({
    id: "starrail.alias_delete",
    plugin: "starrail",
    description: "删除星铁角色别名或昵称",
    intentExamples: ["删除星铁别名泉姐", "删掉流萤昵称"],
    keywords: ["星铁", "角色", "删除", "别名", "昵称"],
    risk: "admin",
    runtimeAliases: STARRAIL_RUNTIME_ALIASES,
    games: ["starrail"],
    slots: [{ name: "alias", required: true, description: "要删除的别名" }],
    commandExamples: ["*删除别名泉姐"],
    build: slots => `*删除别名${cleanEntity(slots.alias)}`,
    validateCommand: /^\*删除(别名|昵称)[^*#\r\n]{1,48}$/,
  }),
  commandFamily({
    id: "starrail.alias_lookup",
    plugin: "starrail",
    description: "查看星铁角色的别名或昵称列表",
    intentExamples: ["黄泉有哪些别名", "查看流萤昵称"],
    keywords: ["星铁", "角色", "查看", "别名", "昵称", "列表"],
    runtimeAliases: STARRAIL_RUNTIME_ALIASES,
    games: ["starrail"],
    slots: [{ name: "character", required: true, description: "星铁角色名称或别名" }],
    commandExamples: ["*黄泉别名", "*流萤昵称"],
    build: slots => `*${cleanEntity(slots.character)}别名`,
    validateCommand: /^\*[^*#\r\n]{1,48}(别名|昵称)$/,
  }),
  commandFamily({
    id: "starrail.rogue_mode",
    plugin: "starrail",
    description: "查看蝗灾、黄金与机械、不可知域或差分宇宙记录",
    intentExamples: ["看看寰宇蝗灾", "黄金与机械战绩", "不可知域", "常规演算第二场"],
    keywords: ["星铁", "模拟宇宙", "蝗灾", "黄金与机械", "不可知域", "差分宇宙", "常规演算", "周期演算", "战绩"],
    runtimeAliases: STARRAIL_RUNTIME_ALIASES,
    games: ["starrail"],
    slots: [
      { name: "mode", required: true, description: "玩法模式", allowedValues: ["蝗灾", "黄金与机械", "不可知域", "差分", "常规演算", "本期演算", "上期演算", "本周演算", "上周演算", "周期演算"] },
      { name: "record", required: false, description: "战绩、回顾、战报或记录", allowedValues: ["战绩", "回顾", "战报", "记录"] },
      { name: "index", required: false, description: "一、二或三", allowedValues: ["一", "二", "三"] },
    ],
    commandExamples: ["*寰宇蝗灾", "*黄金与机械", "*不可知域", "*常规演算记录二", "*本期演算战绩一"],
    build: slots => {
      const mode = cleanEnum(slots.mode, ["蝗灾", "黄金与机械", "不可知域", "差分", "常规演算", "本期演算", "上期演算", "本周演算", "上周演算", "周期演算"])
      const normalized = mode === "蝗灾" ? "寰宇蝗灾" : mode
      return `*${normalized}${slots.record ? cleanEnum(slots.record, ["战绩", "回顾", "战报", "记录"]) : ""}${slots.index ? cleanEnum(slots.index, ["一", "二", "三"]) : ""}`
    },
    validateCommand: /^\*(?:寰宇蝗灾|黄金与机械|不可知域|差分|常规演算(?:战绩|回顾|战报|记录)?[一二三]?|(?:本期|上期|本周|上周)演算(?:战绩|回顾|战报|记录)?[一二三]?|周期演算(?:战绩|回顾|战报|记录)?[一二三]?)$/,
  }),
  commandFamily({
    id: "starrail.currency_war",
    plugin: "starrail",
    description: "查看货币战争总览或指定场次战绩",
    intentExamples: ["看看货币战争", "货币战争第三场战报"],
    keywords: ["星铁", "货币战争", "币战", "战绩", "回顾", "战报", "记录"],
    runtimeAliases: STARRAIL_RUNTIME_ALIASES,
    games: ["starrail"],
    slots: [
      { name: "record", required: false, description: "战绩、回顾、战报或记录；留空看总览", allowedValues: ["战绩", "回顾", "战报", "记录"] },
      { name: "index", required: false, description: "场次一到十", allowedValues: ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"] },
    ],
    commandExamples: ["*货币战争", "*货币战争战报三"],
    build: slots => `*货币战争${slots.record ? cleanEnum(slots.record, ["战绩", "回顾", "战报", "记录"]) : ""}${slots.index ? cleanEnum(slots.index, ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"]) : ""}`,
    validateCommand: /^\*货币战争(?:(战绩|回顾|战报|记录)(一|二|三|四|五|六|七|八|九|十)?)?$/,
  }),
  ...fixedCommandGroup(
    { plugin: "starrail", risk: "admin", autoExecute: false, runtimeAliases: STARRAIL_RUNTIME_ALIASES, games: ["starrail"] },
    [
      {
        id: "starrail.plugin_update",
        description: "更新星铁插件",
        command: "*插件更新",
        intentExamples: ["更新星铁插件"],
        keywords: ["主人", "星铁", "插件", "更新", "升级"],
      },
      {
        id: "starrail.plugin_force_update",
        description: "强制覆盖本地改动并更新星铁插件",
        command: "*插件强制更新",
        intentExamples: ["强制更新星铁插件"],
        keywords: ["主人", "星铁", "插件", "强制", "覆盖", "更新"],
      },
      {
        id: "starrail.image_update",
        description: "更新星铁插件图像资源",
        command: "*更新图像",
        intentExamples: ["更新星铁图像资源"],
        keywords: ["主人", "星铁", "图像", "图片", "资源", "更新"],
      },
      {
        id: "starrail.image_force_update",
        description: "强制更新星铁插件图像资源",
        command: "*强制更新图像github",
        intentExamples: ["从 GitHub 强制更新星铁图像"],
        keywords: ["主人", "星铁", "图像", "资源", "强制", "GitHub", "Gitee", "更新"],
      },
    ],
  ),
  commandFamily({
    id: "starrail.guide_refresh",
    plugin: "starrail",
    description: "更新指定星铁角色攻略图缓存",
    intentExamples: ["更新黄泉攻略", "刷新流萤攻略 all"],
    keywords: ["星铁", "角色", "攻略", "攻略图", "更新", "刷新", "缓存"],
    risk: "write",
    runtimeAliases: STARRAIL_RUNTIME_ALIASES,
    games: ["starrail"],
    characterSlot: "character",
    slots: [
      { name: "character", required: true, description: "星铁角色" },
      { name: "source", required: false, description: "攻略来源数字或 all" },
    ],
    commandExamples: ["*更新黄泉攻略", "*更新流萤攻略all"],
    build: slots => {
      const character = resolveWhitelistedCharacter(slots.character, ["starrail"])
      const source = slots.source ? cleanPatternValue(slots.source, /^(?:\d{1,2}|all)$/, "来源必须是数字或 all") : ""
      return `*更新${character.character}攻略${source}`
    },
    validateCommand: /^\*更新[^*#\s\n]{1,24}攻略(?:\d{1,2}|all)?$/,
  }),
  commandFamily({
    id: "starrail.guide_default_source",
    plugin: "starrail",
    description: "设置星铁攻略图默认来源",
    intentExamples: ["设置星铁默认攻略来源 2", "查看默认攻略来源"],
    keywords: ["主人", "星铁", "攻略", "默认", "来源", "设置"],
    risk: "admin",
    runtimeAliases: STARRAIL_RUNTIME_ALIASES,
    games: ["starrail"],
    slots: [{ name: "source", required: false, description: "可选的来源编号" }],
    commandExamples: ["*设置默认攻略", "*设置默认攻略2"],
    build: slots => `*设置默认攻略${slots.source ? cleanPatternValue(slots.source, /^\d{1,2}$/, "来源编号必须是数字") : ""}`,
    validateCommand: /^\*设置默认攻略\d{0,2}$/,
  }),
]

const waves = [
  fixedCommand({
    id: "waves.help",
    plugin: "waves",
    description: "查看鸣潮插件帮助和功能菜单",
    command: "~帮助",
    intentExamples: ["鸣潮插件怎么用", "看看鸣潮菜单", "鸣潮有哪些功能"],
    keywords: ["鸣潮", "帮助", "菜单", "命令", "功能"],
    runtimeAliases: ["waves-plugin", "鸣潮-"],
  }),
  fixedCommand({
    id: "waves.login_help",
    plugin: "waves",
    description: "查看鸣潮账号登录教程；不会提交 Token",
    command: "~登录帮助",
    intentExamples: ["鸣潮怎么登录", "怎么绑定鸣潮账号", "看看鸣潮登录教程"],
    keywords: ["鸣潮", "登录", "绑定", "账号", "教程", "帮助"],
    runtimeAliases: ["waves-plugin", "鸣潮-"],
  }),
  fixedCommand({
    id: "waves.login",
    plugin: "waves",
    description: "启动鸣潮库街区网页登录流程；不会接收手机号、验证码或 Token 参数",
    command: "~登录",
    intentExamples: ["开始登录鸣潮账号", "现在打开鸣潮网页登录流程"],
    keywords: ["鸣潮", "库街区", "开始", "登录", "网页登录", "账号"],
    risk: "write",
    autoExecute: false,
    runtimeAliases: WAVES_RUNTIME_ALIASES,
  }),
  ...fixedCommandGroup(
    {
      plugin: "waves",
      runtimeAliases: WAVES_RUNTIME_ALIASES,
    },
    [
      {
        id: "waves.task_list",
        description: "查看鸣潮库街区每日任务状态和库洛币数量",
        command: "~任务列表",
        intentExamples: ["看看鸣潮每日任务状态", "查询库街区任务列表"],
        keywords: ["鸣潮", "库街区", "每日任务", "任务列表", "状态", "库洛币"],
      },
      {
        id: "waves.gacha_help",
        description: "查看鸣潮抽卡记录获取和导入教程",
        command: "~抽卡帮助",
        intentExamples: ["鸣潮抽卡记录怎么导入", "看看鸣潮抽卡帮助"],
        keywords: ["鸣潮", "抽卡", "唤取", "记录", "导入", "教程", "帮助"],
      },
      {
        id: "waves.tower_schedule",
        description: "查看鸣潮当期逆境深塔敌人和时间表",
        command: "~当期深塔",
        intentExamples: ["看看鸣潮当期深塔", "本期逆境深塔有什么敌人"],
        keywords: ["鸣潮", "当期", "本期", "逆境深塔", "深塔", "敌人", "时间表"],
      },
      {
        id: "waves.haixu",
        description: "查看自己鸣潮账号的冥歌海墟挑战数据",
        command: "~海墟",
        intentExamples: ["看看我的鸣潮海墟", "查询冥歌海墟战绩"],
        keywords: ["鸣潮", "冥歌海墟", "海墟", "战绩", "挑战数据"],
      },
      {
        id: "waves.haixu_schedule",
        description: "查看鸣潮当期冥歌海墟关卡和敌人信息",
        command: "~当期海墟",
        intentExamples: ["看看鸣潮本期海墟", "当期冥歌海墟有什么敌人"],
        keywords: ["鸣潮", "当期", "本期", "冥歌海墟", "海墟", "关卡", "敌人"],
      },
      {
        id: "waves.matrix",
        description: "查看自己鸣潮账号的终焉矩阵挑战数据",
        command: "~矩阵",
        intentExamples: ["看看我的鸣潮矩阵", "查询终焉矩阵战绩"],
        keywords: ["鸣潮", "终焉矩阵", "矩阵", "战绩", "挑战数据"],
      },
      {
        id: "waves.matrix_schedule",
        description: "查看鸣潮当期终焉矩阵关卡信息",
        command: "~当期矩阵",
        intentExamples: ["看看鸣潮本期矩阵", "当期终焉矩阵是什么"],
        keywords: ["鸣潮", "当期", "本期", "终焉矩阵", "矩阵", "关卡"],
      },
      {
        id: "waves.fotg_schedule",
        description: "查看鸣潮当期千道门扉异想信息",
        command: "~千道门扉",
        intentExamples: ["看看鸣潮千道门扉", "本期千道门扉异想"],
        keywords: ["鸣潮", "千道门扉", "千道", "门扉", "异想", "当期"],
      },
      {
        id: "waves.echo_inventory",
        description: "查看鸣潮账号的声骸仓库和声骸列表",
        command: "~声骸仓库",
        intentExamples: ["看看我的鸣潮声骸仓库", "列出我的声骸"],
        keywords: ["鸣潮", "声骸", "仓库", "背包", "列表"],
      },
    ],
  ),
  fixedCommand({
    id: "waves.sanity",
    plugin: "waves",
    description: "查询鸣潮结晶波片、体力和日常数据",
    command: "~体力",
    intentExamples: ["看看鸣潮体力", "我的波片还有多少", "鸣潮日常数据"],
    keywords: ["鸣潮", "体力", "波片", "结晶波片", "日常"],
    runtimeAliases: ["waves-plugin", "鸣潮-"],
  }),
  fixedCommand({
    id: "waves.card",
    plugin: "waves",
    description: "查看鸣潮账号角色卡片",
    command: "~卡片",
    intentExamples: ["看看我的鸣潮卡片", "查询鸣潮账号信息"],
    keywords: ["鸣潮", "卡片", "账号", "用户", "信息"],
    runtimeAliases: ["waves-plugin", "鸣潮-"],
  }),
  fixedCommand({
    id: "waves.explore",
    plugin: "waves",
    description: "查询鸣潮地图探索度",
    command: "~探索度",
    intentExamples: ["我的鸣潮探索度多少", "看看鸣潮地图进度"],
    keywords: ["鸣潮", "探索度", "地图", "进度"],
    runtimeAliases: ["waves-plugin", "鸣潮-"],
  }),
  fixedCommand({
    id: "waves.challenge",
    plugin: "waves",
    description: "查询鸣潮全息战略挑战数据",
    command: "~全息战略",
    intentExamples: ["看看全息战略", "鸣潮全息挑战数据"],
    keywords: ["鸣潮", "全息", "战略", "挑战"],
    runtimeAliases: ["waves-plugin", "鸣潮-"],
  }),
  fixedCommand({
    id: "waves.tower",
    plugin: "waves",
    description: "查询鸣潮逆境深塔或深境区数据",
    command: "~深境区",
    intentExamples: ["看看鸣潮深塔", "查询逆境深塔", "我的深境区数据"],
    keywords: ["鸣潮", "深塔", "逆境深塔", "深境区", "挑战"],
    runtimeAliases: ["waves-plugin", "鸣潮-"],
  }),
  {
    id: "waves.profile",
    plugin: "waves",
    description: "查询鸣潮指定角色的面板",
    intentExamples: ["看看今汐面板", "查询安可的鸣潮面板", "我的长离练度"],
    keywords: ["鸣潮", "角色", "面板", "练度", "今汐", "安可", "长离"],
    risk: "read",
    autoExecute: true,
    runtimeAliases: ["waves-plugin", "鸣潮-"],
    games: ["waves"],
    characterSlot: "character",
    slots: [
      {
        name: "character",
        required: true,
        description: "鸣潮角色名称或常用别名",
      },
    ],
    commandExamples: ["~今汐面板", "~安可面板"],
    build: slots => {
      const character = resolveWhitelistedCharacter(slots.character, ["waves"])
      return `~${character.character}面板`
    },
    validateCommand: /^~[^~#\n]{1,24}面板$/,
  },
  {
    id: "waves.guide",
    plugin: "waves",
    description: "查询鸣潮指定角色的培养攻略",
    intentExamples: ["今汐怎么培养", "看看安可攻略", "长离配队和攻略"],
    keywords: ["鸣潮", "角色", "培养", "攻略", "配队", "今汐", "安可", "长离"],
    risk: "read",
    autoExecute: true,
    runtimeAliases: ["waves-plugin", "鸣潮-"],
    games: ["waves"],
    characterSlot: "character",
    slots: [
      {
        name: "character",
        required: true,
        description: "鸣潮角色名称或常用别名",
      },
    ],
    commandExamples: ["~今汐攻略", "~安可攻略"],
    build: slots => {
      const character = resolveWhitelistedCharacter(slots.character, ["waves"])
      return `~${character.character}攻略`
    },
    validateCommand: /^~[^~#\n]{1,24}攻略$/,
  },
  {
    id: "waves.atlas",
    plugin: "waves",
    description: "查询鸣潮角色、武器、声骸或物品图鉴",
    intentExamples: ["看看今汐图鉴", "查询某个声骸图鉴", "鸣潮武器资料"],
    keywords: ["鸣潮", "图鉴", "角色", "武器", "声骸", "物品", "资料"],
    risk: "read",
    autoExecute: true,
    runtimeAliases: ["waves-plugin", "鸣潮-"],
    games: ["waves"],
    characterTopicSlot: "topic",
    slots: [
      {
        name: "topic",
        required: true,
        description: "要查询的角色、武器、声骸或物品名称",
      },
    ],
    commandExamples: ["~今汐图鉴", "~无妄者图鉴"],
    build: slots => `~${cleanEntity(slots.topic)}图鉴`,
    validateCommand: /^~[^~#\n]{1,24}图鉴$/,
  },
  fixedCommand({
    id: "waves.calendar",
    plugin: "waves",
    description: "查看鸣潮活动日历",
    command: "~日历",
    intentExamples: ["鸣潮最近有什么活动", "看看鸣潮日历"],
    keywords: ["鸣潮", "日历", "活动", "卡池"],
    runtimeAliases: ["waves-plugin", "鸣潮-"],
  }),
  fixedCommand({
    id: "waves.news",
    plugin: "waves",
    description: "查看鸣潮官方公告和资讯",
    command: "~公告",
    intentExamples: ["鸣潮有什么新公告", "看看鸣潮资讯"],
    keywords: ["鸣潮", "公告", "新闻", "资讯"],
    runtimeAliases: ["waves-plugin", "鸣潮-"],
  }),
  commandFamily({
    id: "waves.gacha_records",
    plugin: "waves",
    description: "查看鸣潮抽卡记录和统计",
    intentExamples: ["看看我的鸣潮抽卡记录", "鸣潮抽卡统计", "查看联动武器抽卡记录"],
    keywords: ["鸣潮", "抽卡", "记录", "统计", "分析", "唤取", "联动", "常驻", "自选", "新手"],
    runtimeAliases: WAVES_RUNTIME_ALIASES,
    games: ["waves"],
    slots: [
      {
        name: "pool",
        required: false,
        description: "要查看的卡池；未说明时查看全部",
        allowedValues: ["联动角色", "联动武器", "角色", "武器", "常驻角色", "常驻武器", "武器常驻", "自选", "新手"],
      },
    ],
    commandExamples: ["~抽卡记录", "~角色抽卡统计", "~联动武器抽卡分析"],
    build: slots => `~${slots.pool ? cleanEnum(slots.pool, ["联动角色", "联动武器", "角色", "武器", "常驻角色", "常驻武器", "武器常驻", "自选", "新手"]) : ""}抽卡记录`,
    validateCommand: /^~(?:常驻)?(?:联动角色|联动武器|角色|武器|武器常驻|自选|新手)?抽卡(?:统计|分析|记录)$/,
  }),
  commandFamily({
    id: "waves.gacha_payload",
    plugin: "waves",
    description: "使用完整请求体或链接读取并保存鸣潮抽卡记录",
    intentExamples: ["用这个链接导入鸣潮抽卡记录", "通过请求体分析鸣潮抽卡"],
    keywords: ["鸣潮", "抽卡", "记录", "统计", "请求体", "链接", "导入", "保存"],
    risk: "sensitive",
    autoExecute: false,
    maxCommandLength: 6200,
    allowNewlines: true,
    runtimeAliases: WAVES_RUNTIME_ALIASES,
    games: ["waves"],
    slots: [
      {
        name: "payload",
        required: true,
        description: "完整的抽卡请求体 JSON 或 HTTP(S) 链接",
      },
      {
        name: "pool",
        required: false,
        description: "要分析的卡池；未说明时分析全部",
        allowedValues: ["联动角色", "联动武器", "角色", "武器", "常驻角色", "常驻武器", "武器常驻", "自选", "新手"],
      },
    ],
    commandExamples: [
      "~抽卡统计https://example.invalid/?player_id=123456789&record_id=REDACTED",
    ],
    build: slots => `~${slots.pool ? cleanEnum(slots.pool, ["联动角色", "联动武器", "角色", "武器", "常驻角色", "常驻武器", "武器常驻", "自选", "新手"]) : ""}抽卡统计${cleanGachaPayload(slots.payload)}`,
    validateCommand: /^~(?:常驻)?(?:联动角色|联动武器|角色|武器|武器常驻|自选|新手)?抽卡(?:统计|分析|记录)(?:https?:\/\/\S+|\{[\s\S]*\})$/i,
  }),
  fixedCommand({
    id: "waves.data_bank",
    plugin: "waves",
    description: "查询鸣潮数据坞和声骸收集数据",
    command: "~数据坞",
    intentExamples: ["看看我的鸣潮数据坞", "查询声骸收集进度"],
    keywords: ["鸣潮", "数据坞", "声骸", "收集", "进度"],
    runtimeAliases: ["waves-plugin", "鸣潮-"],
  }),
  fixedCommand({
    id: "waves.training",
    plugin: "waves",
    description: "查看鸣潮账号的角色练度统计",
    command: "~练度统计",
    intentExamples: ["看看我的鸣潮练度", "统计鸣潮角色练度"],
    keywords: ["鸣潮", "角色", "练度", "统计", "账号"],
    runtimeAliases: ["waves-plugin", "鸣潮-"],
  }),
  fixedCommand({
    id: "waves.sign_records",
    plugin: "waves",
    description: "查看鸣潮库街区签到记录；不会执行签到",
    command: "~签到记录",
    intentExamples: ["看看鸣潮签到记录", "我最近库街区签到了吗"],
    keywords: ["鸣潮", "库街区", "签到", "记录", "历史"],
    runtimeAliases: ["waves-plugin", "鸣潮-"],
  }),
  fixedCommand({
    id: "waves.redemption_codes",
    plugin: "waves",
    description: "查看最近可用的鸣潮兑换码",
    command: "~兑换码",
    intentExamples: ["鸣潮最近有什么兑换码", "给我可用的鸣潮礼包码"],
    keywords: ["鸣潮", "兑换码", "礼包码", "福利", "可用"],
    runtimeAliases: ["waves-plugin", "鸣潮-"],
  }),
  fixedCommand({
    id: "waves.resource_report",
    plugin: "waves",
    description: "查看鸣潮版本星声与资源简报",
    command: "~星声",
    intentExamples: ["这个版本鸣潮有多少星声", "看看鸣潮资源简报"],
    keywords: ["鸣潮", "星声", "资源", "简报", "版本"],
    runtimeAliases: ["waves-plugin", "鸣潮-"],
  }),
  fixedCommand({
    id: "waves.character_ownership",
    plugin: "waves",
    description: "查看鸣潮角色持有率统计",
    command: "~角色持有率",
    intentExamples: ["看看鸣潮角色持有率", "鸣潮大家都抽了哪些角色"],
    keywords: ["鸣潮", "角色", "持有率", "持有", "统计"],
    runtimeAliases: ["waves-plugin", "鸣潮-"],
  }),
  fixedCommand({
    id: "waves.sign",
    plugin: "waves",
    description: "执行一次鸣潮库街区签到；该操作会改变账号状态",
    command: "~签到",
    intentExamples: ["帮我鸣潮签到", "执行库街区签到"],
    keywords: ["鸣潮", "签到", "库街区"],
    risk: "write",
    autoExecute: false,
    runtimeAliases: ["waves-plugin", "鸣潮-"],
  }),
  fixedCommand({
    id: "waves.enable_auto_sign",
    plugin: "waves",
    description: "开启鸣潮自动签到；该操作会修改用户设置",
    command: "~开启自动签到",
    intentExamples: ["帮我开启鸣潮自动签到", "以后每天自动签鸣潮"],
    keywords: ["鸣潮", "开启", "自动", "签到", "每天"],
    risk: "write",
    autoExecute: false,
    runtimeAliases: ["waves-plugin", "鸣潮-"],
  }),
  ...fixedCommandGroup(
    {
      plugin: "waves",
      risk: "write",
      autoExecute: false,
      runtimeAliases: WAVES_RUNTIME_ALIASES,
    },
    [
      {
        id: "waves.daily_task",
        description: "执行鸣潮库街区签到、浏览、点赞和分享每日任务",
        command: "~每日任务",
        intentExamples: ["帮我做鸣潮每日任务", "执行库街区任务"],
        keywords: ["鸣潮", "库街区", "每日任务", "签到", "浏览", "点赞", "分享"],
      },
      {
        id: "waves.disable_auto_sign",
        description: "关闭鸣潮自动签到；该操作会修改用户设置",
        command: "~关闭自动签到",
        intentExamples: ["关闭鸣潮自动签到", "以后不要自动签鸣潮"],
        keywords: ["鸣潮", "关闭", "取消", "自动", "签到"],
      },
      {
        id: "waves.enable_auto_task",
        description: "开启鸣潮库街区自动任务；该操作会修改用户设置",
        command: "~开启自动任务",
        intentExamples: ["开启鸣潮自动任务", "每天自动做库街区任务"],
        keywords: ["鸣潮", "开启", "自动", "每日任务", "库街区"],
      },
      {
        id: "waves.disable_auto_task",
        description: "关闭鸣潮库街区自动任务；该操作会修改用户设置",
        command: "~关闭自动任务",
        intentExamples: ["关闭鸣潮自动任务", "不要再自动做库街区任务"],
        keywords: ["鸣潮", "关闭", "取消", "自动", "每日任务", "库街区"],
      },
    ],
  ),
  commandFamily({
    id: "waves.echo_search",
    plugin: "waves",
    description: "搜索或查询鸣潮声骸资料",
    intentExamples: ["查询无妄者声骸", "搜一下这个声骸"],
    keywords: ["鸣潮", "声骸", "查询", "搜索", "资料"],
    runtimeAliases: WAVES_RUNTIME_ALIASES,
    slots: [{ name: "topic", required: false, description: "声骸名称；可留空打开查询入口" }],
    commandExamples: ["~声骸查询无妄者", "~查声骸"],
    build: slots => `~声骸查询${slots.topic ? cleanEntity(slots.topic) : ""}`,
    validateCommand: /^~(声骸查询|声骸搜索|查声骸)[^~#\r\n]{0,24}$/,
  }),
  wavesLookup({ id: "waves.harmony_info", label: "合鸣", queryWord: "合鸣查询" }),
  wavesLookup({ id: "waves.character_info", label: "角色", queryWord: "角色查询" }),
  wavesLookup({ id: "waves.monster_info", label: "残像", queryWord: "残像查询" }),
  wavesLookup({ id: "waves.weapon_info", label: "武器", queryWord: "武器查询" }),
  wavesLookup({ id: "waves.namecard_info", label: "名片", queryWord: "名片查询" }),
  wavesLookup({ id: "waves.title_info", label: "称号", queryWord: "称号查询" }),
  commandFamily({
    id: "waves.character_english_name",
    plugin: "waves",
    description: "查询鸣潮角色英文名称",
    intentExamples: ["今汐英文名是什么", "查询长离 EN 名称"],
    keywords: ["鸣潮", "角色", "英文", "英语", "EN", "名称", "查询"],
    runtimeAliases: WAVES_RUNTIME_ALIASES,
    characterSlot: "character",
    slots: [{ name: "character", required: true, description: "鸣潮角色名称" }],
    commandExamples: ["~今汐en查询"],
    build: slots => `~${resolveWhitelistedCharacter(slots.character, ["waves"]).character}en查询`,
    validateCommand: /^~[^~#\r\n]{1,24}en查询$/i,
  }),
  wavesSchedule({ id: "waves.matrix_schedule_full", label: "矩阵" }),
  wavesSchedule({ id: "waves.haixu_schedule_full", label: "海墟" }),
  wavesSchedule({ id: "waves.fotg_schedule_full", label: "千道门扉", aliases: ["千道门扉", "千道门扉异想"] }),
  commandFamily({
    id: "waves.tower_schedule_full",
    plugin: "waves",
    description: "查看鸣潮当期、上期、下期或指定期数的逆境深塔信息",
    intentExamples: ["看看上期深塔", "下期逆境深塔", "第 12 期深塔"],
    keywords: ["鸣潮", "逆境深塔", "深塔", "当期", "上期", "下期", "期数", "敌人", "Buff"],
    runtimeAliases: WAVES_RUNTIME_ALIASES,
    slots: [{ name: "period", required: false, description: "当期、上期、下期或 1 到 3 位数字期数" }],
    commandExamples: ["~当期深塔", "~上期深塔", "~12期深塔"],
    build: slots => `~${slots.period ? cleanPatternValue(slots.period, /^(?:当期|上期|下期|\d{1,3}期?)$/, "期数格式不正确") : "当期"}深塔`,
    validateCommand: /^~(?:当期|上期|下期|\d{1,3}期)深塔$/,
  }),
  ...fixedCommandGroup(
    { plugin: "waves", risk: "admin", autoExecute: false, runtimeAliases: WAVES_RUNTIME_ALIASES },
    [
      {
        id: "waves.matrix_cache_clear",
        description: "清除鸣潮终焉矩阵关卡缓存",
        command: "~矩阵清除缓存",
        intentExamples: ["清除矩阵缓存"],
        keywords: ["主人", "鸣潮", "终焉矩阵", "矩阵", "清除", "缓存"],
      },
      {
        id: "waves.haixu_cache_clear",
        description: "清除鸣潮冥歌海墟关卡缓存",
        command: "~海墟清除缓存",
        intentExamples: ["清除海墟缓存"],
        keywords: ["主人", "鸣潮", "冥歌海墟", "海墟", "清除", "缓存"],
      },
      {
        id: "waves.fotg_cache_clear",
        description: "清除鸣潮千道门扉异想缓存",
        command: "~千道门扉异想清除缓存",
        intentExamples: ["清除千道门扉缓存"],
        keywords: ["主人", "鸣潮", "千道门扉", "异想", "清除", "缓存"],
      },
      {
        id: "waves.tower_cache_clear",
        description: "清除鸣潮逆境深塔关卡缓存",
        command: "~清除深塔缓存",
        intentExamples: ["清除深塔缓存"],
        keywords: ["主人", "鸣潮", "逆境深塔", "深塔", "清除", "缓存"],
      },
    ],
  ),
  commandFamily({
    id: "waves.gacha_simulation",
    plugin: "waves",
    description: "执行鸣潮角色或武器模拟十连、百连或抽卡",
    intentExamples: ["来一次鸣潮十连", "武器池百连", "角色模拟抽卡"],
    keywords: ["鸣潮", "模拟", "抽卡", "角色", "武器", "十连", "百连", "百抽"],
    risk: "write",
    runtimeAliases: WAVES_RUNTIME_ALIASES,
    slots: [
      { name: "pool", required: false, description: "角色或武器；未说明时当前池", allowedValues: ["角色", "武器"] },
      { name: "count", required: false, description: "十连、百连或抽卡；未说明时十连", allowedValues: ["十连", "百连", "抽卡"] },
    ],
    commandExamples: ["~十连", "~武器百连", "~角色抽卡"],
    build: slots => `~${slots.pool ? cleanEnum(slots.pool, ["角色", "武器"]) : ""}${slots.count ? cleanEnum(slots.count, ["十连", "百连", "抽卡"]) : "十连"}`,
    validateCommand: /^~(角色|武器)?(十连|百连|抽卡)$/,
  }),
  ...fixedCommandGroup(
    { plugin: "waves", risk: "admin", autoExecute: false, runtimeAliases: WAVES_RUNTIME_ALIASES },
    [
      {
        id: "waves.gacha_resource_update",
        description: "更新鸣潮模拟抽卡资源",
        command: "~更新抽卡资源",
        intentExamples: ["更新鸣潮模拟抽卡资源"],
        keywords: ["主人", "鸣潮", "模拟", "抽卡", "资源", "更新"],
      },
      {
        id: "waves.gacha_pity_reset",
        description: "重置鸣潮模拟抽卡保底计数",
        command: "~重置抽卡保底",
        intentExamples: ["重置鸣潮模拟器保底"],
        keywords: ["主人", "鸣潮", "模拟", "抽卡", "重置", "保底"],
      },
    ],
  ),
  commandFamily({
    id: "waves.gacha_pool_switch",
    plugin: "waves",
    description: "切换鸣潮模拟抽卡卡池",
    intentExamples: ["切换到今汐卡池", "换模拟抽卡池"],
    keywords: ["鸣潮", "模拟", "抽卡", "卡池", "切换", "更换"],
    risk: "write",
    runtimeAliases: WAVES_RUNTIME_ALIASES,
    slots: [{ name: "pool", required: true, description: "要切换的卡池名称" }],
    commandExamples: ["~切换卡池今汐"],
    build: slots => `~切换卡池${cleanEntity(slots.pool)}`,
    validateCommand: /^~切换卡池[^~#\r\n]{1,32}$/,
  }),
  fixedCommand({
    id: "waves.gacha_pool_view",
    plugin: "waves",
    description: "查看鸣潮模拟器当前可抽取卡池",
    command: "~查看卡池",
    intentExamples: ["查看鸣潮模拟卡池", "当前能抽哪些池"],
    keywords: ["鸣潮", "模拟", "抽卡", "查看", "当前", "卡池"],
    runtimeAliases: WAVES_RUNTIME_ALIASES,
  }),
  commandFamily({
    id: "waves.bind_code",
    plugin: "waves",
    description: "绑定鸣潮特征码或进入特征码绑定流程",
    intentExamples: ["绑定鸣潮特征码", "开始绑定鸣潮"],
    keywords: ["鸣潮", "特征码", "绑定", "账号"],
    risk: "sensitive",
    runtimeAliases: WAVES_RUNTIME_ALIASES,
    slots: [{ name: "code", required: false, description: "可选的特征码；留空进入交互流程" }],
    commandExamples: ["~绑定", "~绑定REDACTED"],
    build: slots => `~绑定${slots.code ? cleanCommandArgument(slots.code, "特征码格式不正确", 80) : ""}`,
    validateCommand: /^~绑定[^~#\r\n]{0,80}$/,
  }),
  ...fixedCommandGroup(
    { plugin: "waves", risk: "sensitive", autoExecute: false, runtimeAliases: WAVES_RUNTIME_ALIASES },
    [
      {
        id: "waves.token_show",
        description: "查看已登录鸣潮库街区账号 Token",
        command: "~我的token",
        intentExamples: ["查看我的鸣潮 Token", "显示库街区 tk"],
        keywords: ["鸣潮", "库街区", "我的", "Token", "tk", "查看"],
      },
      {
        id: "waves.gacha_link_show",
        description: "查看鸣潮云登录账号的抽卡链接",
        command: "~我的抽卡链接",
        intentExamples: ["查看我的鸣潮抽卡链接"],
        keywords: ["鸣潮", "云登录", "我的", "抽卡", "链接", "查看"],
      },
    ],
  ),
  fixedCommand({
    id: "waves.login_delete",
    plugin: "waves",
    description: "解除或删除鸣潮库街区登录账号",
    command: "~解除登录",
    intentExamples: ["解除鸣潮登录", "解绑库街区账号"],
    keywords: ["鸣潮", "库街区", "解除", "删除", "解绑", "登录", "账号"],
    risk: "write",
    autoExecute: false,
    runtimeAliases: WAVES_RUNTIME_ALIASES,
  }),
  fixedCommand({
    id: "waves.current_pool",
    plugin: "waves",
    description: "查看鸣潮当前角色与武器卡池",
    command: "~当前卡池",
    intentExamples: ["鸣潮当前卡池是什么", "看看现在的角色池"],
    keywords: ["鸣潮", "当前", "卡池", "角色池", "武器池", "日历"],
    runtimeAliases: WAVES_RUNTIME_ALIASES,
  }),
  commandFamily({
    id: "waves.character_ownership_scope",
    plugin: "waves",
    description: "查看鸣潮个人、群或 Bot 的四星或五星角色持有率",
    intentExamples: ["看看群里五星角色持有率", "Bot 四星持有率"],
    keywords: ["鸣潮", "群", "Bot", "四星", "五星", "角色", "持有率", "统计"],
    runtimeAliases: WAVES_RUNTIME_ALIASES,
    slots: [
      { name: "scope", required: false, description: "个人、群或 Bot", allowedValues: ["个人", "群", "Bot"] },
      { name: "rarity", required: false, description: "四星或五星；留空查看全部", allowedValues: ["四星", "五星"] },
    ],
    commandExamples: ["~群五星角色持有率", "~bot四星持有率", "~角色持有率"],
    build: slots => `~${slots.scope && slots.scope !== "个人" ? (slots.scope === "Bot" ? "bot" : "群") : ""}${slots.rarity ? cleanEnum(slots.rarity, ["四星", "五星"]) : ""}角色持有率`,
    validateCommand: /^~(群|bot)?(四星|五星)?(角色)?持有率$/,
  }),
  commandFamily({
    id: "waves.character_ranking",
    plugin: "waves",
    description: "查看鸣潮角色声骸群排名或总排名",
    intentExamples: ["看看今汐排名", "长离总排行榜第 2 页"],
    keywords: ["鸣潮", "角色", "声骸", "群", "总", "排行", "排名", "排行榜"],
    runtimeAliases: WAVES_RUNTIME_ALIASES,
    characterSlot: "character",
    slots: [
      { name: "character", required: true, description: "鸣潮角色" },
      { name: "scope", required: false, description: "群或总；未说明时群", allowedValues: ["群", "总"] },
      { name: "page", required: false, description: "页码 1 到 5", allowedValues: ["1", "2", "3", "4", "5"] },
    ],
    commandExamples: ["~今汐排名", "~长离总排行榜2"],
    build: slots => `~${resolveWhitelistedCharacter(slots.character, ["waves"]).character}${slots.scope === "总" ? "总" : ""}排名${slots.page ? cleanEnum(slots.page, ["1", "2", "3", "4", "5"]) : ""}`,
    validateCommand: /^~[^~#\r\n]{1,24}(总)?(排行|排名|排名榜|排行榜)[1-5]?$/,
  }),
  fixedCommand({
    id: "waves.ranking_data_sync",
    plugin: "waves",
    description: "同步鸣潮角色排行榜数据",
    command: "~同步排名数据",
    intentExamples: ["同步鸣潮排名数据"],
    keywords: ["鸣潮", "同步", "数据", "排行", "排名"],
    risk: "admin",
    autoExecute: false,
    runtimeAliases: WAVES_RUNTIME_ALIASES,
  }),
  commandFamily({
    id: "waves.ranking_setting",
    plugin: "waves",
    description: "开启、关闭或查看鸣潮群排名和总排名录入模式",
    intentExamples: ["开启鸣潮总排名", "关闭群排名", "查看排名状态"],
    keywords: ["主人", "鸣潮", "开启", "关闭", "群排名", "总排名", "状态", "开关"],
    risk: "admin",
    runtimeAliases: WAVES_RUNTIME_ALIASES,
    slots: [
      { name: "action", required: true, description: "开启、关闭或状态", allowedValues: ["开启", "关闭", "状态"] },
      { name: "scope", required: false, description: "群或总；状态时可留空", allowedValues: ["群", "总"] },
    ],
    commandExamples: ["~开启总排名", "~关闭群排名", "~排名状态"],
    build: slots => slots.action === "状态"
      ? "~排名状态"
      : `~${cleanEnum(slots.action, ["开启", "关闭"])}${slots.scope ? cleanEnum(slots.scope, ["群", "总"]) : "总"}排名`,
    validateCommand: /^~(?:(开启|关闭)(总|群)排名|排名状态)$/,
  }),
  wavesRanking({ id: "waves.matrix_ranking", label: "矩阵" }),
  wavesRanking({ id: "waves.haixu_ranking", label: "海墟" }),
  commandFamily({
    id: "waves.challenge_ranking_setting",
    plugin: "waves",
    description: "配置或查看鸣潮矩阵、海墟群榜和总榜录入状态",
    intentExamples: ["开启矩阵总排名", "关闭海墟群榜", "查看矩阵排名状态"],
    keywords: ["主人", "鸣潮", "矩阵", "海墟", "群榜", "总榜", "排名", "开启", "关闭", "状态"],
    risk: "admin",
    runtimeAliases: WAVES_RUNTIME_ALIASES,
    slots: [
      { name: "mode", required: true, description: "矩阵或海墟", allowedValues: ["矩阵", "海墟"] },
      { name: "action", required: true, description: "开启、关闭或状态", allowedValues: ["开启", "关闭", "状态"] },
      { name: "scope", required: false, description: "群或总；状态时可留空", allowedValues: ["群", "总"] },
    ],
    commandExamples: ["~开启矩阵总排名", "~关闭海墟群排行", "~矩阵排名状态"],
    build: slots => {
      const mode = cleanEnum(slots.mode, ["矩阵", "海墟"])
      if (slots.action === "状态") return `~${mode}排名状态`
      return `~${cleanEnum(slots.action, ["开启", "关闭"])}${mode}${slots.scope ? cleanEnum(slots.scope, ["群", "总"]) : "总"}排名`
    },
    validateCommand: /^~(?:(开启|关闭)(矩阵|海墟)(总|群)(排行|排行榜|排名)|(矩阵|海墟)(排行|排行榜|排名)状态)$/,
  }),
  ...fixedCommandGroup(
    { plugin: "waves", risk: "admin", autoExecute: false, runtimeAliases: WAVES_RUNTIME_ALIASES },
    [
      {
        id: "waves.user_stats",
        description: "查看鸣潮用户、账号与 Token 数量统计",
        command: "~用户统计",
        intentExamples: ["查看鸣潮用户统计"],
        keywords: ["主人", "鸣潮", "用户", "账号", "Token", "tk", "统计"],
      },
      {
        id: "waves.invalid_users_delete",
        description: "删除鸣潮全部失效账号或 Token",
        command: "~删除失效用户",
        intentExamples: ["删除鸣潮失效用户", "清理无效 Token"],
        keywords: ["主人", "鸣潮", "删除", "清理", "失效", "用户", "账号", "Token"],
      },
    ],
  ),
  commandFamily({
    id: "waves.resource_report_period",
    plugin: "waves",
    description: "按版本或月份查看鸣潮星声资源简报",
    intentExamples: ["看看 2.3 版本星声", "9 月资源简报"],
    keywords: ["鸣潮", "版本", "月份", "资源", "资源简报", "星声"],
    runtimeAliases: WAVES_RUNTIME_ALIASES,
    slots: [
      { name: "version", required: false, description: "可选版本号，例如 2.3" },
      { name: "month", required: false, description: "可选月份 1 到 12" },
    ],
    commandExamples: ["~2.3版本星声", "~9月资源简报"],
    build: slots => {
      const version = slots.version ? cleanPatternValue(slots.version, /^\d+\.\d+$/, "版本号格式不正确") : ""
      const month = slots.month ? cleanPatternValue(slots.month, /^(?:[1-9]|1[0-2])$/, "月份必须是 1 到 12") : ""
      return `~${version ? `${version}版本` : ""}${month ? `${month}月` : ""}星声`
    },
    validateCommand: /^~(?:\d+\.\d+版本)?(?:\d{1,2}月)?(?:资源?简报|星声)$/,
  }),
  commandFamily({
    id: "waves.alias_set",
    plugin: "waves",
    description: "为鸣潮角色添加别名或昵称",
    intentExamples: ["给今汐添加别名今夕", "设置长离昵称"],
    keywords: ["鸣潮", "角色", "添加", "设置", "别名", "昵称"],
    risk: "admin",
    runtimeAliases: WAVES_RUNTIME_ALIASES,
    slots: [
      { name: "character", required: true, description: "鸣潮角色名称" },
      { name: "alias", required: true, description: "要添加的别名" },
    ],
    commandExamples: ["~添加今汐别名今夕"],
    build: slots => `~添加${cleanEntity(slots.character)}别名${cleanEntity(slots.alias)}`,
    validateCommand: /^~添加[^~#\r\n]{1,24}(别名|昵称)[^~#\r\n]{1,24}$/,
  }),
  commandFamily({
    id: "waves.alias_delete",
    plugin: "waves",
    description: "删除鸣潮角色别名或昵称",
    intentExamples: ["删除今汐别名今夕"],
    keywords: ["鸣潮", "角色", "删除", "别名", "昵称"],
    risk: "admin",
    runtimeAliases: WAVES_RUNTIME_ALIASES,
    slots: [
      { name: "character", required: true, description: "鸣潮角色名称" },
      { name: "alias", required: true, description: "要删除的别名" },
    ],
    commandExamples: ["~删除今汐别名今夕"],
    build: slots => `~删除${cleanEntity(slots.character)}别名${cleanEntity(slots.alias)}`,
    validateCommand: /^~删除[^~#\r\n]{1,24}(别名|昵称)[^~#\r\n]{1,24}$/,
  }),
  commandFamily({
    id: "waves.alias_lookup",
    plugin: "waves",
    description: "查看鸣潮角色别名或昵称列表",
    intentExamples: ["今汐有哪些别名", "查看长离昵称"],
    keywords: ["鸣潮", "角色", "查看", "别名", "昵称", "列表"],
    runtimeAliases: WAVES_RUNTIME_ALIASES,
    slots: [{ name: "character", required: true, description: "鸣潮角色名称或别名" }],
    commandExamples: ["~今汐别名"],
    build: slots => `~${cleanEntity(slots.character)}别名`,
    validateCommand: /^~[^~#\r\n]{1,24}(别名|昵称)$/,
  }),
  commandFamily({
    id: "waves.rerun_prediction",
    plugin: "waves",
    description: "查看鸣潮角色复刻预测、排行或记录",
    intentExamples: ["今汐什么时候复刻", "看看复刻排行", "共鸣者复刻记录"],
    keywords: ["鸣潮", "角色", "共鸣者", "复刻", "预测", "排行", "记录"],
    runtimeAliases: WAVES_RUNTIME_ALIASES,
    slots: [
      { name: "character", required: false, description: "角色名称；查看排行或记录时留空" },
      { name: "view", required: false, description: "预测、排行或记录", allowedValues: ["预测", "排行", "记录"] },
    ],
    commandExamples: ["~今汐复刻", "~复刻排行", "~共鸣者记录"],
    build: slots => {
      const view = slots.view ? cleanEnum(slots.view, ["预测", "排行", "记录"]) : slots.character ? "预测" : "排行"
      if (view === "预测") return `~${cleanEntity(slots.character)}复刻`
      if (view === "记录") return "~共鸣者记录"
      return "~复刻排行"
    },
    validateCommand: /^~(?:[^~#\r\n]{1,24}复刻|复刻排行|共鸣者记录)$/,
  }),
  commandFamily({
    id: "waves.encore_resources",
    plugin: "waves",
    description: "下载、更新、删除或查看 waves-plugin Encore 数据资源",
    intentExamples: ["下载全部 Encore 资源", "更新声骸 Encore", "删除 Encore 所有资源", "查看 Encore 资源状态"],
    keywords: ["主人", "鸣潮", "Encore", "资源", "下载", "更新", "删除", "状态", "角色", "声骸", "残像", "名片", "称号", "武器", "深塔", "海墟", "千道", "矩阵"],
    risk: "admin",
    runtimeAliases: WAVES_RUNTIME_ALIASES,
    slots: [
      { name: "action", required: true, description: "下载、更新、删除或状态", allowedValues: ["下载", "更新", "删除", "状态"] },
      { name: "scope", required: false, description: "全部、角色、声骸、残像、名片、称号、武器、深塔、海墟、千道或矩阵", allowedValues: ["全部", "角色", "声骸", "残像", "名片", "称号", "武器", "深塔", "海墟", "千道", "矩阵"] },
    ],
    commandExamples: ["~下载encore所有资源", "~更新encore资源", "~encore资源状态", "~下载角色encore"],
    build: slots => {
      const action = cleanEnum(slots.action, ["下载", "更新", "删除", "状态"])
      const scope = slots.scope ? cleanEnum(slots.scope, ["全部", "角色", "声骸", "残像", "名片", "称号", "武器", "深塔", "海墟", "千道", "矩阵"]) : "全部"
      if (action === "状态") return "~encore资源状态"
      if (["下载", "更新", "删除"].includes(action) && scope === "全部") return `~${action}encore所有资源`
      if (action !== "下载") return `~${action}encore资源`
      return `~下载${scope}encore`
    },
    validateCommand: /^~(?:(下载|更新|删除)encore(所有)?资源|encore资源状态|下载(全部|角色|声骸|残像|怪物|名片|称号|武器|深塔|海墟|千道|矩阵)encore)$/i,
  }),
  commandFamily({
    id: "waves.character_score",
    plugin: "waves",
    description: "通过 OCR 查看鸣潮指定角色面板评分",
    intentExamples: ["给今汐面板评分", "看看长离评分"],
    keywords: ["鸣潮", "角色", "面板", "OCR", "评分", "分数"],
    runtimeAliases: WAVES_RUNTIME_ALIASES,
    characterSlot: "character",
    slots: [{ name: "character", required: true, description: "鸣潮角色" }],
    commandExamples: ["~今汐评分"],
    build: slots => `~${resolveWhitelistedCharacter(slots.character, ["waves"]).character}评分`,
    validateCommand: /^~[^~#\r\n]{1,24}评分$/,
  }),
  commandFamily({
    id: "waves.character_max_profile",
    plugin: "waves",
    description: "查看鸣潮指定角色的极限面板",
    intentExamples: ["看看今汐极限面板", "长离理论毕业面板"],
    keywords: ["鸣潮", "角色", "极限", "理论", "毕业", "面板"],
    runtimeAliases: WAVES_RUNTIME_ALIASES,
    characterSlot: "character",
    slots: [{ name: "character", required: true, description: "鸣潮角色" }],
    commandExamples: ["~今汐极限面板"],
    build: slots => `~${resolveWhitelistedCharacter(slots.character, ["waves"]).character}极限面板`,
    validateCommand: /^~[^~#\r\n]{1,24}极限面板$/,
  }),
  commandFamily({
    id: "waves.score_weight",
    plugin: "waves",
    description: "查看鸣潮总评分权重或指定角色评分权重",
    intentExamples: ["查看评分权重", "今汐各属性权重"],
    keywords: ["鸣潮", "角色", "评分", "属性", "权重"],
    runtimeAliases: WAVES_RUNTIME_ALIASES,
    slots: [{ name: "character", required: false, description: "鸣潮角色；留空查看总评分权重" }],
    commandExamples: ["~评分权重", "~今汐权重"],
    build: slots => slots.character ? `~${cleanEntity(slots.character)}权重` : "~评分权重",
    validateCommand: /^~(?:评分|[^~#\r\n]{1,24})权重$/,
  }),
  commandFamily({
    id: "waves.echo_replace",
    plugin: "waves",
    description: "计算鸣潮角色更换指定声骸后的面板",
    intentExamples: ["今汐换无妄者声骸", "长离替换声骸计算"],
    keywords: ["鸣潮", "角色", "更换", "替换", "声骸", "面板", "计算"],
    runtimeAliases: WAVES_RUNTIME_ALIASES,
    slots: [
      { name: "character", required: true, description: "鸣潮角色" },
      { name: "echo", required: true, description: "要更换的声骸或方案" },
    ],
    commandExamples: ["~今汐更换无妄者声骸"],
    build: slots => `~${cleanEntity(slots.character)}更换${cleanEntity(slots.echo)}声骸`,
    validateCommand: /^~[^~#\r\n]{1,24}(更换|替换|换)[^~#\r\n]{1,24}声骸$/,
  }),
  commandFamily({
    id: "waves.panel_image_upload",
    plugin: "waves",
    description: "上传鸣潮指定角色面板图",
    intentExamples: ["上传今汐面板图"],
    keywords: ["鸣潮", "角色", "上传", "面板图", "图片"],
    risk: "admin",
    runtimeAliases: WAVES_RUNTIME_ALIASES,
    slots: [{ name: "character", required: true, description: "鸣潮角色" }],
    commandExamples: ["~上传今汐面板图"],
    build: slots => `~上传${cleanEntity(slots.character)}面板图`,
    validateCommand: /^~上传[^~#\r\n]{1,24}面板图$/,
  }),
  fixedCommand({
    id: "waves.original_image",
    plugin: "waves",
    description: "获取所引用鸣潮面板图的原图",
    command: "~原图",
    intentExamples: ["获取鸣潮面板原图"],
    keywords: ["鸣潮", "面板图", "原图", "图片"],
    runtimeAliases: WAVES_RUNTIME_ALIASES,
  }),
  commandFamily({
    id: "waves.panel_image_list",
    plugin: "waves",
    description: "查看鸣潮指定角色全部面板图",
    intentExamples: ["看看今汐面板图列表"],
    keywords: ["鸣潮", "角色", "面板图", "列表", "图片"],
    runtimeAliases: WAVES_RUNTIME_ALIASES,
    slots: [{ name: "character", required: true, description: "鸣潮角色" }],
    commandExamples: ["~今汐面板图列表"],
    build: slots => `~${cleanEntity(slots.character)}面板图列表`,
    validateCommand: /^~[^~#\r\n]{1,24}面板图列表$/,
  }),
  commandFamily({
    id: "waves.panel_image_delete",
    plugin: "waves",
    description: "删除鸣潮指定角色的某张面板图",
    intentExamples: ["删除今汐第 1 张面板图"],
    keywords: ["鸣潮", "角色", "删除", "面板图", "序号"],
    risk: "admin",
    runtimeAliases: WAVES_RUNTIME_ALIASES,
    slots: [
      { name: "character", required: true, description: "鸣潮角色" },
      { name: "index", required: true, description: "面板图序号" },
    ],
    commandExamples: ["~删除今汐面板图1"],
    build: slots => `~删除${cleanEntity(slots.character)}面板图${cleanPatternValue(slots.index, /^\d{1,3}$/, "序号必须是数字")}`,
    validateCommand: /^~删除[^~#\r\n]{1,24}面板图\d{1,3}$/,
  }),
  ...fixedCommandGroup(
    { plugin: "waves", risk: "sensitive", autoExecute: false, runtimeAliases: WAVES_RUNTIME_ALIASES },
    [
      {
        id: "waves.cloud_login",
        description: "启动云鸣潮网页登录流程",
        command: "~云登录",
        intentExamples: ["开始云鸣潮登录", "打开云鸣潮网页登录"],
        keywords: ["鸣潮", "云鸣潮", "云登录", "网页", "登录"],
      },
      {
        id: "waves.cloud_login_delete",
        description: "解除云鸣潮登录状态",
        command: "~解除云登录",
        intentExamples: ["解除云鸣潮登录"],
        keywords: ["鸣潮", "云鸣潮", "解除", "删除", "云登录"],
      },
      {
        id: "waves.gacha_import",
        description: "导入鸣潮抽卡记录",
        command: "~导入抽卡记录",
        intentExamples: ["导入鸣潮抽卡记录"],
        keywords: ["鸣潮", "抽卡", "唤取", "导入", "记录"],
      },
      {
        id: "waves.gacha_export",
        description: "导出鸣潮抽卡记录",
        command: "~导出抽卡记录",
        intentExamples: ["导出鸣潮抽卡记录"],
        keywords: ["鸣潮", "抽卡", "唤取", "导出", "记录"],
      },
    ],
  ),
  fixedCommand({
    id: "waves.gacha_update",
    plugin: "waves",
    description: "通过云鸣潮登录数据更新抽卡记录",
    command: "~更新抽卡记录",
    intentExamples: ["更新我的鸣潮抽卡记录", "同步最新鸣潮唤取记录", "拉取鸣潮抽卡数据"],
    keywords: ["鸣潮", "云鸣潮", "更新", "同步", "抽卡", "唤取", "记录"],
    risk: "write",
    autoExecute: false,
    runtimeAliases: WAVES_RUNTIME_ALIASES,
  }),
  fixedCommand({
    id: "waves.shock_simulation",
    plugin: "waves",
    description: "执行鸣潮今日声骸梭哈模拟",
    command: "~今日梭哈",
    intentExamples: ["今天鸣潮梭哈一下", "来个声骸梭哈"],
    keywords: ["鸣潮", "今日", "声骸", "梭哈", "模拟"],
    risk: "write",
    autoExecute: false,
    runtimeAliases: WAVES_RUNTIME_ALIASES,
  }),
  fixedCommand({
    id: "waves.emoji",
    plugin: "waves",
    description: "随机发送一张鸣潮表情包",
    command: "~随机表情包",
    intentExamples: ["来张鸣潮表情包", "随机鸣潮表情"],
    keywords: ["鸣潮", "随机", "表情", "表情包", "图片"],
    runtimeAliases: WAVES_RUNTIME_ALIASES,
  }),
  commandFamily({
    id: "waves.cosplay",
    plugin: "waves",
    description: "随机或按序号查看鸣潮 Cosplay 图片",
    intentExamples: ["来张鸣潮 cos", "看看第 3 张 cosplay"],
    keywords: ["鸣潮", "Cos", "Cosplay", "图片", "随机", "序号"],
    runtimeAliases: WAVES_RUNTIME_ALIASES,
    slots: [{ name: "index", required: false, description: "可选图片序号" }],
    commandExamples: ["~cos", "~cosplay3"],
    build: slots => `~cos${slots.index ? cleanPatternValue(slots.index, /^\d{1,3}$/, "序号必须是数字") : ""}`,
    validateCommand: /^~(cos|cosplay)\d*$/i,
  }),
  ...fixedCommandGroup(
    { plugin: "waves", risk: "admin", autoExecute: false, runtimeAliases: WAVES_RUNTIME_ALIASES },
    [
      {
        id: "waves.plugin_update",
        description: "更新鸣潮插件",
        command: "~插件更新",
        intentExamples: ["更新鸣潮插件"],
        keywords: ["主人", "鸣潮", "插件", "更新", "升级"],
      },
      {
        id: "waves.plugin_force_update",
        description: "强制覆盖本地改动并更新鸣潮插件",
        command: "~插件强制更新",
        intentExamples: ["强制更新鸣潮插件"],
        keywords: ["主人", "鸣潮", "插件", "强制", "覆盖", "更新"],
      },
      {
        id: "waves.cosplay_cache_clear",
        description: "清空鸣潮 Cosplay 图片缓存",
        command: "~cos清空",
        intentExamples: ["清空鸣潮 cos 缓存"],
        keywords: ["主人", "鸣潮", "Cos", "Cosplay", "清空", "缓存"],
      },
      {
        id: "waves.sign_all",
        description: "为全部鸣潮账号批量执行签到",
        command: "~全部签到",
        intentExamples: ["全部鸣潮账号签到"],
        keywords: ["主人", "鸣潮", "全部", "批量", "账号", "签到"],
      },
      {
        id: "waves.task_all",
        description: "为全部鸣潮账号批量执行每日任务",
        command: "~全部每日任务",
        intentExamples: ["全部鸣潮账号执行每日任务"],
        keywords: ["主人", "鸣潮", "全部", "批量", "账号", "每日任务"],
      },
    ],
  ),
  commandFamily({
    id: "waves.stamina_push",
    plugin: "waves",
    description: "开启或关闭鸣潮结晶波片体力推送",
    intentExamples: ["开启鸣潮体力推送", "关闭波片提醒"],
    keywords: ["鸣潮", "结晶波片", "波片", "体力", "开启", "关闭", "推送", "提醒"],
    risk: "write",
    runtimeAliases: WAVES_RUNTIME_ALIASES,
    slots: [{ name: "action", required: true, description: "开启或关闭", allowedValues: ["开启", "关闭"] }],
    commandExamples: ["~开启体力推送", "~关闭波片推送"],
    build: slots => `~${cleanEnum(slots.action, ["开启", "关闭"])}体力推送`,
    validateCommand: /^~(开启|关闭)(波片|体力)?推送$/,
  }),
  commandFamily({
    id: "waves.news_push",
    plugin: "waves",
    description: "开启或关闭鸣潮公告、新闻或活动推送",
    intentExamples: ["开启鸣潮公告推送", "关闭活动推送"],
    keywords: ["鸣潮", "公告", "新闻", "活动", "开启", "关闭", "推送"],
    risk: "admin",
    runtimeAliases: WAVES_RUNTIME_ALIASES,
    slots: [
      { name: "action", required: true, description: "开启或关闭", allowedValues: ["开启", "关闭"] },
      { name: "type", required: false, description: "公告、新闻或活动", allowedValues: ["公告", "新闻", "活动"] },
    ],
    commandExamples: ["~开启公告推送", "~关闭活动推送"],
    build: slots => `~${cleanEnum(slots.action, ["开启", "关闭"])}${slots.type ? cleanEnum(slots.type, ["公告", "新闻", "活动"]) : "公告"}推送`,
    validateCommand: /^~(开启|关闭)(公告|新闻|活动)推送$/,
  }),
  commandFamily({
    id: "waves.stamina_threshold",
    plugin: "waves",
    description: "设置鸣潮结晶波片或体力提醒阈值",
    intentExamples: ["把鸣潮体力阈值设为 200", "波片满 220 提醒"],
    keywords: ["鸣潮", "结晶波片", "波片", "体力", "阈值", "上限", "提醒", "设置"],
    risk: "write",
    runtimeAliases: WAVES_RUNTIME_ALIASES,
    slots: [{ name: "value", required: true, description: "体力阈值数字" }],
    commandExamples: ["~体力阈值200"],
    build: slots => `~体力阈值${cleanPatternValue(slots.value, /^\d{1,4}$/, "体力阈值必须是数字")}`,
    validateCommand: /^~(波片|体力)阈值\d{1,4}$/,
  }),
]

// waves-plugin 的全部预设只服务于鸣潮。统一标注后，角色白名单和显式游戏名
// 都能在进入模型前排除跨游戏候选。
for (const candidate of waves) candidate.games ??= ["waves"]

const xiaoyao = [
  fixedCommand({
    id: "xiaoyao.help",
    plugin: "xiaoyao",
    description: "查看逍遥图鉴插件帮助",
    command: "#图鉴帮助",
    intentExamples: ["逍遥图鉴怎么用", "看看图鉴菜单", "原神图鉴有哪些功能"],
    keywords: ["逍遥", "图鉴", "原神", "帮助", "菜单", "功能"],
    runtimeAliases: [...XIAOYAO_RUNTIME_ALIASES, ...GENSHIN_RUNTIME_ALIASES],
    runtimeRuleOptional: true,
  }),
  fixedCommand({
    id: "xiaoyao.version",
    plugin: "xiaoyao",
    description: "查看逍遥图鉴插件版本",
    command: "#图鉴版本",
    intentExamples: ["图鉴插件是什么版本", "查看逍遥版本"],
    keywords: ["逍遥", "图鉴", "版本", "更新"],
    runtimeAliases: ["xiaoyao-cvs-plugin", "图鉴插件"],
    runtimeRuleOptional: true,
  }),
  fixedCommand({
    id: "xiaoyao.stamina",
    plugin: "xiaoyao",
    description: "查询原神树脂和实时便笺数据",
    command: "#体力",
    intentExamples: ["看看原神体力", "我的树脂多少", "查询实时便笺"],
    keywords: ["原神", "体力", "树脂", "便笺", "便签"],
    runtimeAliases: ["xiaoyao-cvs-plugin", "图鉴插件"],
    runtimeRuleOptional: true,
    games: ["genshin"],
  }),
  {
    id: "xiaoyao.atlas",
    plugin: "xiaoyao",
    description: "查询原神或星铁角色、武器、食物、怪物、圣遗物等图鉴",
    intentExamples: ["看看胡桃图鉴", "查询护摩之杖资料", "无相之雷是什么怪"],
    keywords: [
      "原神",
      "星铁",
      "图鉴",
      "角色",
      "武器",
      "食物",
      "怪物",
      "圣遗物",
      "资料",
      "胡桃",
      "护摩之杖",
    ],
    risk: "read",
    autoExecute: true,
    runtimeAliases: ["xiaoyao-cvs-plugin", "图鉴插件"],
    runtimeRuleOptional: true,
    games: ["genshin", "starrail"],
    characterTopicSlot: "topic",
    slots: [
      {
        name: "topic",
        required: true,
        description: "要查询的角色、武器、食物、怪物或圣遗物名称",
      },
    ],
    commandExamples: ["#胡桃图鉴", "#护摩之杖图鉴", "#无相之雷图鉴"],
    build: (slots, { context } = {}) => {
      const character = characterRegistry.resolve(slots.topic, {
        games: gamesFromContext(context, ["genshin", "starrail"]),
      })
      if (character.ok) {
        const gamePrefix = character.game === "starrail" ? "星铁" : ""
        return `#${gamePrefix}${character.character}图鉴`
      }
      return `#${cleanEntity(slots.topic)}图鉴`
    },
    validateCommand: /^#[^#~\n]{1,24}图鉴$/,
  },
  {
    id: "xiaoyao.map_location",
    plugin: "xiaoyao",
    description: "查询原神材料、怪物或采集物在地图上的位置",
    intentExamples: ["琉璃袋在哪里", "无相之雷去哪找", "原神清心位置"],
    keywords: ["原神", "地图", "位置", "在哪里", "哪找", "采集", "材料", "怪物"],
    risk: "read",
    autoExecute: true,
    runtimeAliases: ["xiaoyao-cvs-plugin", "图鉴插件"],
    runtimeRuleOptional: true,
    games: ["genshin"],
    slots: [
      {
        name: "topic",
        required: true,
        description: "要查找的材料、怪物或采集物名称",
      },
      {
        name: "refresh",
        required: false,
        description: "使用缓存或强制刷新地图资源",
        allowedValues: ["缓存", "刷新"],
      },
    ],
    commandExamples: ["#琉璃袋在哪里", "#刷新无相之雷在哪里"],
    build: slots => `#${slots.refresh === "刷新" ? "刷新" : ""}${cleanEntity(slots.topic)}在哪里`,
    validateCommand: /^#(刷新|更新)?[^#~\n]{1,24}在哪里$/,
  },
  fixedCommand({
    id: "xiaoyao.account_help",
    plugin: "xiaoyao",
    description: "查看米游社账号绑定与签到配置教程；不会提交凭据",
    command: "#米游社帮助",
    intentExamples: [
      "原神米游社怎么绑定",
      "米游社签到怎么配置",
      "看看米游社签到教程",
    ],
    keywords: ["米游社", "账号", "绑定", "签到配置", "教程", "帮助", "Cookie"],
    runtimeAliases: ["xiaoyao-cvs-plugin", "图鉴插件"],
    runtimeRuleOptional: true,
    games: ["genshin", "starrail", "zzz"],
  }),
  fixedCommand({
    id: "xiaoyao.qr_login",
    plugin: "xiaoyao",
    description: "发起原神米游社扫码登录或扫码绑定",
    command: "#扫码登录",
    intentExamples: [
      "我要扫码登录",
      "执行原神扫码登录",
      "给我原神登录二维码",
      "用二维码绑定米游社",
    ],
    keywords: ["原神", "米游社", "扫码", "二维码", "登录", "登陆", "绑定"],
    risk: "write",
    autoExecute: false,
    runtimeAliases: ["xiaoyao-cvs-plugin", "图鉴插件"],
    runtimeRuleOptional: true,
    games: ["genshin"],
  }),
  fixedCommand({
    id: "xiaoyao.currency_status",
    plugin: "xiaoyao",
    description: "查看米游币签到状态和当前米游币数量",
    command: "#米游币查询",
    intentExamples: ["看看我的米游币", "查询米游币签到状态"],
    keywords: ["米游社", "米游币", "米币", "签到", "状态", "数量", "查询"],
    runtimeAliases: XIAOYAO_RUNTIME_ALIASES,
    runtimeRuleOptional: true,
  }),
  ...fixedCommandGroup(
    {
      plugin: "xiaoyao",
      risk: "write",
      autoExecute: false,
      runtimeAliases: XIAOYAO_RUNTIME_ALIASES,
      runtimeRuleOptional: true,
    },
    [
      {
        id: "xiaoyao.genshin_sign",
        description: "执行一次米游社原神游戏签到",
        command: "#原神签到",
        intentExamples: ["帮我原神签到", "执行米游社原神签到"],
        keywords: ["原神", "米游社", "签到", "游戏签到"],
        games: ["genshin"],
      },
      {
        id: "xiaoyao.starrail_sign",
        description: "执行一次米游社星铁游戏签到",
        command: "#星铁签到",
        intentExamples: ["帮我星铁签到", "执行米游社星穹铁道签到"],
        keywords: ["星铁", "星穹铁道", "米游社", "签到", "游戏签到"],
        games: ["starrail"],
      },
      {
        id: "xiaoyao.zzz_sign",
        description: "执行一次米游社绝区零游戏签到",
        command: "#绝区零签到",
        intentExamples: ["帮我绝区零签到", "执行米游社绝区零签到"],
        keywords: ["绝区零", "米游社", "签到", "游戏签到"],
        games: ["zzz"],
      },
      {
        id: "xiaoyao.gacha_update",
        description: "从米游社获取并更新原神抽卡记录；会写入本地抽卡数据",
        command: "#更新抽卡记录",
        intentExamples: [
          "更新一下我的原神抽卡记录",
          "帮我同步原神祈愿记录",
          "拉取最新的原神抽卡记录",
        ],
        keywords: ["原神", "米游社", "更新", "同步", "抽卡", "祈愿", "记录"],
        games: ["genshin"],
      },
    ],
  ),
  ...fixedCommandGroup(
    { plugin: "xiaoyao", risk: "admin", autoExecute: false, runtimeAliases: XIAOYAO_RUNTIME_ALIASES, runtimeRuleOptional: true },
    [
      {
        id: "xiaoyao.map_cache_clear",
        description: "清空逍遥图鉴下载的原神地图缓存数据",
        command: "#清空地图缓存数据",
        intentExamples: ["清空图鉴地图缓存", "删除地图下载数据"],
        keywords: ["主人", "逍遥", "图鉴", "原神", "地图", "缓存", "数据", "清空", "清除"],
        games: ["genshin"],
      },
      {
        id: "xiaoyao.resource_update",
        description: "更新逍遥图鉴图片与素材资源",
        command: "#图鉴更新",
        intentExamples: ["更新逍遥图鉴素材"],
        keywords: ["主人", "逍遥", "图鉴", "图片", "素材", "资源", "更新"],
      },
      {
        id: "xiaoyao.resource_force_update",
        description: "强制覆盖更新逍遥图鉴图片与素材资源",
        command: "#图鉴强制更新",
        intentExamples: ["强制更新逍遥图鉴素材"],
        keywords: ["主人", "逍遥", "图鉴", "图片", "素材", "强制", "覆盖", "更新"],
      },
      {
        id: "xiaoyao.plugin_update",
        description: "更新逍遥图鉴插件",
        command: "#图鉴插件更新",
        intentExamples: ["更新逍遥图鉴插件"],
        keywords: ["主人", "逍遥", "图鉴", "插件", "更新", "升级"],
      },
      {
        id: "xiaoyao.plugin_force_update",
        description: "强制覆盖本地改动并更新逍遥图鉴插件",
        command: "#图鉴插件强制更新",
        intentExamples: ["强制更新逍遥图鉴插件"],
        keywords: ["主人", "逍遥", "图鉴", "插件", "强制", "覆盖", "更新"],
      },
      {
        id: "xiaoyao.template_update",
        description: "更新逍遥图鉴体力模板资源",
        command: "#图鉴模板更新",
        intentExamples: ["更新逍遥图鉴模板"],
        keywords: ["主人", "逍遥", "图鉴", "体力", "模板", "资源", "更新"],
      },
      {
        id: "xiaoyao.template_force_update",
        description: "强制覆盖更新逍遥图鉴体力模板资源",
        command: "#图鉴模板强制更新",
        intentExamples: ["强制更新逍遥图鉴模板"],
        keywords: ["主人", "逍遥", "图鉴", "模板", "强制", "覆盖", "更新"],
      },
    ],
  ),
  commandFamily({
    id: "xiaoyao.settings",
    plugin: "xiaoyao",
    description: "查看或修改逍遥图鉴插件系统设置",
    intentExamples: ["打开图鉴设置", "关闭逍遥体力功能", "设置扫码绑定模式"],
    keywords: ["主人", "逍遥", "图鉴", "设置", "配置", "体力", "帮助", "匹配", "戳一戳", "模板", "扫码绑定", "星铁图鉴"],
    risk: "admin",
    runtimeAliases: XIAOYAO_RUNTIME_ALIASES,
    runtimeRuleOptional: true,
    slots: [
      { name: "setting", required: false, description: "体力、帮助、匹配、戳一戳、模板、获取sk、目录、扫码绑定、星铁图鉴或星铁匹配", allowedValues: ["体力", "帮助", "匹配", "戳一戳", "模板", "获取sk", "目录", "扫码绑定", "星铁图鉴", "星铁匹配"] },
      { name: "value", required: false, description: "开启、关闭或数字配置值" },
    ],
    commandExamples: ["#图鉴设置", "#图鉴设置体力关闭", "#图鉴设置扫码绑定2"],
    build: slots => `#图鉴设置${slots.setting ? cleanEnum(slots.setting, ["体力", "帮助", "匹配", "戳一戳", "模板", "获取sk", "目录", "扫码绑定", "星铁图鉴", "星铁匹配"]) : ""}${slots.value ? cleanCommandArgument(slots.value, "设置值格式不正确", 24) : ""}`,
    validateCommand: /^#图鉴设置(?:体力|帮助|匹配|戳一戳|模板|获取sk|目录|扫码绑定|星铁图鉴|星铁匹配)?[^#\r\n]{0,24}$/i,
  }),
  commandFamily({
    id: "xiaoyao.game_sign",
    plugin: "xiaoyao",
    description: "执行原神、星铁、绝区零、崩坏、未定事件簿或大别野游戏签到",
    intentExamples: ["帮我崩坏三签到", "未定事件簿签到", "全部游戏签到"],
    keywords: ["米游社", "原神", "星铁", "绝区零", "崩坏三", "崩坏二", "未定事件簿", "大别野", "全部", "游戏", "签到"],
    risk: "write",
    runtimeAliases: XIAOYAO_RUNTIME_ALIASES,
    runtimeRuleOptional: true,
    slots: [{ name: "game", required: true, description: "要签到的游戏或全部", allowedValues: ["原神", "星铁", "绝区零", "崩坏3", "崩坏2", "未定事件簿", "大别野", "全部", "游戏"] }],
    commandExamples: ["#崩坏3签到", "#未定事件簿签到", "#游戏签到"],
    build: slots => `#${cleanEnum(slots.game, ["原神", "星铁", "绝区零", "崩坏3", "崩坏2", "未定事件簿", "大别野", "全部", "游戏"])}签到`,
    validateCommand: /^#(原神|星铁|绝区零|崩坏3|崩坏2|未定事件簿|大别野|全部|游戏)签到$/,
  }),
  commandFamily({
    id: "xiaoyao.community_sign",
    plugin: "xiaoyao",
    description: "执行指定米游社社区板块签到以获取米游币",
    intentExamples: ["米游社原神社区签到", "社区全部签到", "mys 星铁签到"],
    keywords: ["米游社", "MYS", "社区", "原神", "星铁", "绝区零", "崩坏", "未定事件簿", "大别野", "全部", "签到", "米游币"],
    risk: "write",
    runtimeAliases: XIAOYAO_RUNTIME_ALIASES,
    runtimeRuleOptional: true,
    slots: [
      { name: "prefix", required: false, description: "米游社、mys 或社区", allowedValues: ["米游社", "mys", "社区"] },
      { name: "game", required: true, description: "社区板块", allowedValues: ["原神", "崩坏3", "崩坏2", "未定事件簿", "大别野", "崩坏星穹铁道", "绝区零", "全部"] },
    ],
    commandExamples: ["#米游社原神签到", "#mys崩坏3签到", "#社区全部签到"],
    build: slots => `#${slots.prefix ? cleanEnum(slots.prefix, ["米游社", "mys", "社区"]) : "米游社"}${cleanEnum(slots.game, ["原神", "崩坏3", "崩坏2", "未定事件簿", "大别野", "崩坏星穹铁道", "绝区零", "全部"])}签到`,
    validateCommand: /^#(米游社|mys|社区)(原神|崩坏3|崩坏2|未定事件簿|大别野|崩坏星穹铁道|绝区零|全部)签到$/i,
  }),
  fixedCommand({
    id: "xiaoyao.cloud_genshin_sign",
    plugin: "xiaoyao",
    description: "执行一次云原神签到",
    command: "#云原神签到",
    intentExamples: ["帮我云原神签到"],
    keywords: ["原神", "云原神", "云游戏", "签到"],
    risk: "write",
    autoExecute: false,
    runtimeAliases: XIAOYAO_RUNTIME_ALIASES,
    runtimeRuleOptional: true,
    games: ["genshin"],
  }),
  fixedCommand({
    id: "xiaoyao.cloud_genshin_status",
    plugin: "xiaoyao",
    description: "查询云原神签到与时长状态",
    command: "#云原神查询",
    intentExamples: ["查询云原神状态", "看看云原神剩余时长"],
    keywords: ["原神", "云原神", "查询", "状态", "时长"],
    runtimeAliases: XIAOYAO_RUNTIME_ALIASES,
    runtimeRuleOptional: true,
    games: ["genshin"],
  }),
  commandFamily({
    id: "xiaoyao.account_help_full",
    plugin: "xiaoyao",
    description: "查看米游社 Cookie、米游币、Stoken 或云原神绑定教程",
    intentExamples: ["Stoken 怎么绑定", "云原神绑定教程", "Cookie 获取帮助"],
    keywords: ["米游社", "Cookie", "米游币", "Stoken", "云原神", "帮助", "教程", "绑定"],
    runtimeAliases: XIAOYAO_RUNTIME_ALIASES,
    runtimeRuleOptional: true,
    slots: [{ name: "topic", required: true, description: "帮助主题", allowedValues: ["米游社", "cookies", "米游币", "stoken", "云原神", "云"] }],
    commandExamples: ["#stoken帮助", "#云原神教程", "#cookies绑定"],
    build: slots => `#${cleanEnum(slots.topic, ["米游社", "cookies", "米游币", "stoken", "云原神", "云"])}帮助`,
    validateCommand: /^#(米游社|cookies|米游币|stoken|云原神|云)(帮助|教程|绑定)$/i,
  }),
  commandFamily({
    id: "xiaoyao.sign_all",
    plugin: "xiaoyao",
    description: "为全部账号批量执行米游币、云原神或米社游戏签到",
    intentExamples: ["全部账号米游币签到", "批量云原神签到", "米社原神全部签到"],
    keywords: ["主人", "米游币", "云原神", "米社", "原神", "崩坏", "未定事件簿", "全部", "批量", "签到"],
    risk: "admin",
    runtimeAliases: XIAOYAO_RUNTIME_ALIASES,
    runtimeRuleOptional: true,
    slots: [{ name: "task", required: true, description: "批量任务类型", allowedValues: ["米游币", "云原神", "米社", "米社原神", "米社崩坏3", "米社崩坏2", "米社未定事件簿"] }],
    commandExamples: ["#米游币全部签到", "#云原神全部签到", "#米社原神全部签到"],
    build: slots => `#${cleanEnum(slots.task, ["米游币", "云原神", "米社", "米社原神", "米社崩坏3", "米社崩坏2", "米社未定事件簿"])}全部签到`,
    validateCommand: /^#(米游币|云原神|米社(?:原神|崩坏3|崩坏2|未定事件簿)?)全部签到$/,
  }),
  commandFamily({
    id: "xiaoyao.stamina_push",
    plugin: "xiaoyao",
    description: "开启、关闭或配置原神体力推送与群推送阈值",
    intentExamples: ["开启原神体力推送", "关闭群体力提醒", "体力群推送阈值 150"],
    keywords: ["逍遥", "原神", "体力", "树脂", "群", "推送", "阈值", "上限", "开启", "关闭"],
    risk: "write",
    runtimeAliases: XIAOYAO_RUNTIME_ALIASES,
    runtimeRuleOptional: true,
    games: ["genshin"],
    slots: [
      { name: "mode", required: true, description: "个人开启、个人关闭、群开启、群关闭、群阈值或群上限", allowedValues: ["个人开启", "个人关闭", "群开启", "群关闭", "群阈值", "群上限"] },
      { name: "value", required: false, description: "群阈值或上限数字" },
    ],
    commandExamples: ["#开启体力推送", "#体力设置群推送关闭", "#体力设置群阈值150"],
    build: slots => {
      const mode = cleanEnum(slots.mode, ["个人开启", "个人关闭", "群开启", "群关闭", "群阈值", "群上限"])
      if (mode === "个人开启") return "#开启体力推送"
      if (mode === "个人关闭") return "#关闭体力推送"
      if (mode === "群开启") return "#体力设置群推送开启"
      if (mode === "群关闭") return "#体力设置群推送关闭"
      return `#体力设置${mode === "群阈值" ? "群阈值" : "群上限"}${cleanPatternValue(slots.value, /^\d{1,4}$/, "阈值或上限必须是数字")}`
    },
    validateCommand: /^#(?:(开启|关闭)体力推送|体力设置群(?:推送(开启|关闭)|(阈值|上限)\d+))$/,
  }),
  commandFamily({
    id: "xiaoyao.stamina_template",
    plugin: "xiaoyao",
    description: "设置、查看或移除原神体力展示模板",
    intentExamples: ["设置体力模板", "查看我的体力模板列表", "移除体力模板 2"],
    keywords: ["逍遥", "原神", "体力", "模板", "设置", "列表", "我的", "移除"],
    risk: "write",
    runtimeAliases: XIAOYAO_RUNTIME_ALIASES,
    runtimeRuleOptional: true,
    games: ["genshin"],
    slots: [
      { name: "action", required: true, description: "设置、列表、我的列表或移除", allowedValues: ["设置", "列表", "我的列表", "移除"] },
      { name: "value", required: false, description: "模板编号或设置内容" },
    ],
    commandExamples: ["#体力模板设置1", "#体力模板列表", "#我的体力模板列表", "#体力模板移除1"],
    build: slots => {
      const action = cleanEnum(slots.action, ["设置", "列表", "我的列表", "移除"])
      if (action === "我的列表") return "#我的体力模板列表"
      return `#体力模板${action}${slots.value ? cleanCommandArgument(slots.value, "模板参数格式不正确", 32) : ""}`
    },
    validateCommand: /^#(?:体力模板(?:设置[^#\r\n]{0,32}|列表[^#\r\n]{0,32}|移除[^#\r\n]{0,32})|我的体力模板列表)$/,
  }),
  fixedCommand({
    id: "xiaoyao.poke_stamina",
    plugin: "xiaoyao",
    description: "通过戳一戳事件查询原神体力",
    command: "#poke#",
    intentExamples: ["戳一戳查体力", "用戳一戳触发逍遥体力"],
    keywords: ["逍遥", "原神", "戳一戳", "Poke", "体力"],
    runtimeAliases: XIAOYAO_RUNTIME_ALIASES,
    runtimeRuleOptional: true,
    games: ["genshin"],
  }),
  commandFamily({
    id: "xiaoyao.character_video",
    plugin: "xiaoyao",
    description: "获取原神角色动态或幻影视频",
    intentExamples: ["看看角色动态", "给我胡桃幻影"],
    keywords: ["逍遥", "原神", "角色", "动态", "幻影", "视频"],
    runtimeAliases: XIAOYAO_RUNTIME_ALIASES,
    runtimeRuleOptional: true,
    games: ["genshin"],
    slots: [
      { name: "type", required: false, description: "动态或幻影", allowedValues: ["动态", "幻影"] },
      { name: "character", required: false, description: "可选角色名称" },
    ],
    commandExamples: ["#动态", "#幻影胡桃"],
    build: slots => `#${slots.type ? cleanEnum(slots.type, ["动态", "幻影"]) : "动态"}${slots.character ? cleanEntity(slots.character) : ""}`,
    validateCommand: /^#(动态|幻影)[^#\r\n]{0,24}$/,
  }),
  commandFamily({
    id: "xiaoyao.user_info",
    plugin: "xiaoyao",
    description: "查看已绑定 Cookie、Stoken 或签到账号的个人信息",
    intentExamples: ["查看 CK 信息", "查询 Stoken 账号", "签到账号信息"],
    keywords: ["逍遥", "原神", "Cookie", "CK", "Stoken", "签到", "账号", "查询"],
    risk: "sensitive",
    runtimeAliases: XIAOYAO_RUNTIME_ALIASES,
    runtimeRuleOptional: true,
    slots: [{ name: "type", required: false, description: "ck、stoken、cookie、cookies 或签到", allowedValues: ["ck", "stoken", "cookie", "cookies", "签到"] }],
    commandExamples: ["#ck查询", "#stoken查询", "#签到查询"],
    build: slots => `#${slots.type ? cleanEnum(slots.type, ["ck", "stoken", "cookie", "cookies", "签到"]) : "ck"}查询`,
    validateCommand: /^#(ck|stoken|cookie|cookies|签到)查询$/i,
  }),
  commandFamily({
    id: "xiaoyao.gacha_export",
    plugin: "xiaoyao",
    description: "获取或导出原神抽卡记录链接与数据",
    intentExamples: ["获取原神抽卡记录链接", "导出祈愿记录"],
    keywords: ["逍遥", "原神", "获取", "导出", "抽卡", "祈愿", "记录", "链接"],
    risk: "sensitive",
    runtimeAliases: XIAOYAO_RUNTIME_ALIASES,
    runtimeRuleOptional: true,
    games: ["genshin"],
    slots: [{ name: "action", required: false, description: "获取或导出", allowedValues: ["获取", "导出"] }],
    commandExamples: ["#获取抽卡记录", "#导出抽卡记录"],
    build: slots => `#${slots.action ? cleanEnum(slots.action, ["获取", "导出"]) : "获取"}抽卡记录`,
    validateCommand: /^#(获取|导出)抽卡记录$/,
  }),
  commandFamily({
    id: "xiaoyao.payment_records",
    plugin: "xiaoyao",
    description: "刷新、获取或导出原神充值与氪金记录",
    intentExamples: ["刷新原神充值记录", "导出氪金记录"],
    keywords: ["逍遥", "原神", "刷新", "获取", "导出", "充值", "氪金", "记录"],
    risk: "sensitive",
    runtimeAliases: XIAOYAO_RUNTIME_ALIASES,
    runtimeRuleOptional: true,
    games: ["genshin"],
    slots: [
      { name: "action", required: false, description: "刷新、获取或导出", allowedValues: ["刷新", "获取", "导出"] },
      { name: "type", required: false, description: "充值或氪金", allowedValues: ["充值", "氪金"] },
    ],
    commandExamples: ["#刷新充值记录", "#导出氪金记录"],
    build: slots => `#${slots.action ? cleanEnum(slots.action, ["刷新", "获取", "导出"]) : "刷新"}${slots.type ? cleanEnum(slots.type, ["充值", "氪金"]) : "充值"}记录`,
    validateCommand: /^#(刷新|获取|导出)(充值|氪金)记录$/,
  }),
  commandFamily({
    id: "xiaoyao.token_show",
    plugin: "xiaoyao",
    description: "查看已绑定的 Stoken 或云原神 Cookie",
    intentExamples: ["查看我的 Stoken", "显示云 CK"],
    keywords: ["逍遥", "我的", "Stoken", "云原神", "云 CK", "查看"],
    risk: "sensitive",
    runtimeAliases: XIAOYAO_RUNTIME_ALIASES,
    runtimeRuleOptional: true,
    slots: [{ name: "type", required: false, description: "stoken 或云ck", allowedValues: ["stoken", "云ck"] }],
    commandExamples: ["#我的stoken", "#我的云ck"],
    build: slots => `#我的${slots.type ? cleanEnum(slots.type, ["stoken", "云ck"]) : "stoken"}`,
    validateCommand: /^#我的(stoken|云ck)$/i,
  }),
  commandFamily({
    id: "xiaoyao.stoken_payload",
    plugin: "xiaoyao",
    description: "提交 Stoken 内容进行米游社账号绑定",
    intentExamples: ["提交 Stoken 绑定逍遥图鉴"],
    keywords: ["逍遥", "米游社", "Stoken", "绑定", "账号"],
    risk: "sensitive",
    runtimeAliases: XIAOYAO_RUNTIME_ALIASES,
    runtimeRuleOptional: true,
    slots: [{ name: "payload", required: true, description: "包含 stoken= 的完整凭据" }],
    commandExamples: ["stoken=REDACTED"],
    build: slots => cleanCommandArgument(slots.payload, "Stoken 格式不正确", 190),
    validateCommand: /^(?=[^\r\n]*stoken=)[^\r\n]{8,190}$/i,
  }),
  commandFamily({
    id: "xiaoyao.login_ticket_payload",
    plugin: "xiaoyao",
    description: "提交 login_ticket 内容以自动获取并绑定 Stoken",
    intentExamples: ["提交 login_ticket 自动绑定 Stoken"],
    keywords: ["逍遥", "米游社", "login_ticket", "Stoken", "绑定"],
    risk: "sensitive",
    runtimeAliases: XIAOYAO_RUNTIME_ALIASES,
    runtimeRuleOptional: true,
    slots: [{ name: "payload", required: true, description: "包含 login_ticket= 的完整凭据" }],
    commandExamples: ["login_ticket=REDACTED"],
    build: slots => cleanCommandArgument(slots.payload, "login_ticket 格式不正确", 190),
    validateCommand: /^(?=[^\r\n]*login_ticket=)[^\r\n]{8,190}$/i,
  }),
  commandFamily({
    id: "xiaoyao.cloud_token_payload",
    plugin: "xiaoyao",
    description: "提交云原神 ct Token 进行绑定",
    intentExamples: ["提交云原神 ct Token"],
    keywords: ["逍遥", "云原神", "CT", "Token", "绑定"],
    risk: "sensitive",
    runtimeAliases: XIAOYAO_RUNTIME_ALIASES,
    runtimeRuleOptional: true,
    slots: [{ name: "payload", required: true, description: "完整云原神 ct Token" }],
    commandExamples: ["ct=REDACTED"],
    build: slots => cleanCommandArgument(slots.payload, "云原神 Token 格式不正确", 190),
    validateCommand: /^(?=[^\r\n]*ct)[^\r\n]{4,190}$/i,
  }),
  commandFamily({
    id: "xiaoyao.credential_delete",
    plugin: "xiaoyao",
    description: "删除已绑定的 Stoken、SK 或云原神 Cookie",
    intentExamples: ["删除我的 Stoken", "删除云 CK", "清掉 SK"],
    keywords: ["逍遥", "删除", "我的", "Stoken", "SK", "云原神", "云 CK"],
    risk: "sensitive",
    runtimeAliases: XIAOYAO_RUNTIME_ALIASES,
    runtimeRuleOptional: true,
    slots: [{ name: "type", required: true, description: "stoken、sk、云原神或云ck", allowedValues: ["stoken", "sk", "云原神", "云ck"] }],
    commandExamples: ["#删除我的stoken", "#删除云ck"],
    build: slots => `#删除我的${cleanEnum(slots.type, ["stoken", "sk", "云原神", "云ck"])}`,
    validateCommand: /^#删除(我的)?(stoken|sk|云原神|云ck)$/i,
  }),
  commandFamily({
    id: "xiaoyao.cookie_refresh",
    plugin: "xiaoyao",
    description: "刷新、更新或重新获取米游社 Cookie",
    intentExamples: ["刷新 CK", "更新 Cookie", "重新获取 Cookie"],
    keywords: ["逍遥", "米游社", "刷新", "更新", "获取", "Cookie", "CK"],
    risk: "sensitive",
    runtimeAliases: XIAOYAO_RUNTIME_ALIASES,
    runtimeRuleOptional: true,
    slots: [{ name: "action", required: false, description: "刷新、更新或获取", allowedValues: ["刷新", "更新", "获取"] }],
    commandExamples: ["#刷新ck", "#更新cookie", "#获取ck"],
    build: slots => `#${slots.action ? cleanEnum(slots.action, ["刷新", "更新", "获取"]) : "刷新"}ck`,
    validateCommand: /^#(刷新|更新|获取)(ck|cookie)$/i,
  }),
  fixedCommand({
    id: "xiaoyao.password_login",
    plugin: "xiaoyao",
    description: "进入米游社账号密码登录或绑定流程",
    command: "#账号登录",
    intentExamples: ["使用账号密码登录米游社", "开始账号绑定"],
    keywords: ["逍遥", "米游社", "账号", "密码", "登录", "绑定"],
    risk: "sensitive",
    autoExecute: false,
    runtimeAliases: XIAOYAO_RUNTIME_ALIASES,
    runtimeRuleOptional: true,
  }),
  commandFamily({
    id: "xiaoyao.password_payload",
    plugin: "xiaoyao",
    description: "提交米游社账号与密码完成登录",
    intentExamples: ["提交米游社账号密码"],
    keywords: ["逍遥", "米游社", "账号", "密码", "登录", "凭据"],
    risk: "sensitive",
    runtimeAliases: XIAOYAO_RUNTIME_ALIASES,
    runtimeRuleOptional: true,
    slots: [
      { name: "account", required: true, description: "米游社账号" },
      { name: "password", required: true, description: "米游社密码" },
    ],
    commandExamples: ["账号REDACTED密码REDACTED"],
    build: slots => `账号${cleanCommandArgument(slots.account, "账号格式不正确", 64)}密码${cleanCommandArgument(slots.password, "密码格式不正确", 64)}`,
    validateCommand: /^账号[^\r\n]{1,64}密码[^\r\n]{1,64}$/,
  }),
  commandFamily({
    id: "xiaoyao.topup",
    plugin: "xiaoyao",
    description: "查看原神充值商品、创建充值或查询订单",
    intentExamples: ["查看原神充值列表", "原神微信充值", "查询充值订单"],
    keywords: ["逍遥", "原神", "微信", "充值", "商品", "列表", "订单", "查询"],
    risk: "sensitive",
    runtimeAliases: XIAOYAO_RUNTIME_ALIASES,
    runtimeRuleOptional: true,
    slots: [
      { name: "action", required: true, description: "商品列表、充值或查询订单", allowedValues: ["商品列表", "充值", "查询订单"] },
      { name: "detail", required: false, description: "充值商品或订单参数" },
    ],
    commandExamples: ["#商品列表", "#原神微信充值", "#查询订单"],
    build: slots => {
      const action = cleanEnum(slots.action, ["商品列表", "充值", "查询订单"])
      if (action === "商品列表") return "#商品列表"
      if (action === "查询订单") return `#查询订单${slots.detail ? cleanCommandArgument(slots.detail, "订单参数格式不正确", 48) : ""}`
      return `#原神充值${slots.detail ? cleanCommandArgument(slots.detail, "充值参数格式不正确", 48) : ""}`
    },
    validateCommand: /^#(?:商品列表|充值列表|原神(?:微信)?充值(?:微信)?[^#\r\n]{0,48}|(?:订单查询|查询订单)[^#\r\n]{0,48})$/,
  }),
]

export const PRESET_COMMANDS = { miao, waves, xiaoyao }

export function createCustomCandidate(input) {
  if (!input || typeof input !== "object") return null

  const id = String(input.id || "").trim()
  const plugin = String(input.plugin || "custom").trim()
  const description = String(input.description || "").trim()
  const command = String(input.command || "").trim()
  const risk = String(input.risk || "read").trim()
  const runtimeAliases = Array.isArray(input.runtimeAliases)
    ? input.runtimeAliases.map(String).filter(Boolean)
    : [plugin]

  if (
    !/^custom\.[a-zA-Z0-9_.-]{1,100}$/.test(id) ||
    !description ||
    !command ||
    !["read", "write", "sensitive", "admin"].includes(risk) ||
    command.length > 200 ||
    /[\r\n]/.test(command)
  ) {
    return null
  }

  return fixedCommand({
    id,
    plugin,
    description,
    command,
    intentExamples: Array.isArray(input.intentExamples)
      ? input.intentExamples.map(String).slice(0, 20)
      : [],
    keywords: Array.isArray(input.keywords) ? input.keywords.map(String).slice(0, 30) : [],
    risk,
    autoExecute: risk === "read" && input.autoExecute === true,
    runtimeAliases,
    runtimeRuleOptional: input.runtimeRuleOptional === true,
  })
}

export {
  cleanEntity,
  cleanEnum,
  cleanGameUid,
  escapeRegExp,
  gamesFromContext,
  fixedCommand,
  characterGuide,
}
