import {
  characterRegistry,
  resolveWhitelistedCharacter,
} from "./CharacterRegistry.js"

const SAFE_ENTITY_PATTERN = /^[A-Za-z0-9\u3400-\u9fff·・_\-\s]{1,24}$/
const FORBIDDEN_ENTITY_WORDS =
  /(删除|清除|移除|更新|重载|设置|上传|添加|开启|关闭|登录|绑定|解绑|强制|重启|token|cookie|stoken|api.?key)/i

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
  fixedCommand({
    id: "miao.genshin_calendar",
    plugin: "miao",
    description: "查看原神活动日历",
    command: "#日历",
    intentExamples: ["看看原神日历", "原神最近有什么活动", "原神活动时间"],
    keywords: ["原神", "日历", "活动", "卡池"],
    runtimeAliases: ["miao-plugin", "喵喵"],
    games: ["genshin"],
  }),
  fixedCommand({
    id: "miao.starrail_calendar",
    plugin: "miao",
    description: "查看崩坏：星穹铁道活动日历",
    command: "#星铁日历",
    intentExamples: ["看看星铁日历", "星穹铁道最近有什么活动", "铁道活动时间"],
    keywords: ["星铁", "星穹铁道", "铁道", "日历", "活动", "卡池"],
    runtimeAliases: ["miao-plugin", "喵喵"],
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
    runtimeAliases: ["miao-plugin", "喵喵"],
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
  fixedCommand({
    id: "waves.gacha_records",
    plugin: "waves",
    description: "查看鸣潮抽卡记录和统计",
    command: "~抽卡记录",
    intentExamples: ["看看我的鸣潮抽卡记录", "鸣潮抽卡统计"],
    keywords: ["鸣潮", "抽卡", "记录", "统计", "唤取"],
    runtimeAliases: ["waves-plugin", "鸣潮-"],
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
    runtimeAliases: ["xiaoyao-cvs-plugin", "图鉴插件"],
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
    ],
    commandExamples: ["#琉璃袋在哪里", "#无相之雷在哪里"],
    build: slots => `#${cleanEntity(slots.topic)}在哪里`,
    validateCommand: /^#[^#~\n]{1,24}在哪里$/,
  },
  fixedCommand({
    id: "xiaoyao.account_help",
    plugin: "xiaoyao",
    description: "查看米游社账号绑定与签到配置教程；不会提交凭据",
    command: "#米游社帮助",
    intentExamples: ["原神米游社怎么绑定", "看看米游社签到教程"],
    keywords: ["原神", "米游社", "账号", "绑定", "签到", "教程", "帮助"],
    runtimeAliases: ["xiaoyao-cvs-plugin", "图鉴插件"],
    runtimeRuleOptional: true,
    games: ["genshin"],
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

export { cleanEntity, cleanEnum, escapeRegExp, gamesFromContext, fixedCommand }
