import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import YAML from "yaml"

export const GAME_LABELS = {
  genshin: "原神",
  waves: "鸣潮",
  starrail: "星铁",
  zzz: "绝区零",
}

const GAME_PATTERNS = {
  genshin: /(原神|提瓦特|genshin)/i,
  waves: /(鸣潮|库街区|共鸣者|声骸)/i,
  starrail: /(星铁|星穹铁道|崩坏[:：·\s]*星穹铁道|铁道|star\s*rail|hsr)/i,
  zzz: /(绝区零|绝区|zenless|zzz)/i,
}

// 这些内置名单让插件即使单独运行也能安全判定游戏归属。启动于 Yunzai
// 后还会读取已安装插件的原始预设，自动补充新角色和完整别名。
//
// 原神、星铁：
//   yoimiya-kokomi/miao-plugin resources/meta-{gs,sr}/character
// 鸣潮：
//   ziyiLike/waves-plugin resources/Alias/role.yaml
// 绝区零（仅用于游戏归属识别，不代表当前三个业务插件提供角色命令）：
//   ZZZure/ZZZ-Plugin defSet/alias.yaml
const BUILTIN_CHARACTER_NAMES = {
  genshin: `
    神里绫华 琴 空 丽莎 荧 芭芭拉 凯亚 迪卢克 雷泽 安柏 温迪 香菱 北斗 行秋 魈
    凝光 可莉 钟离 菲谢尔 班尼特 达达利亚 诺艾尔 七七 重云 甘雨 阿贝多 迪奥娜 莫娜
    刻晴 砂糖 辛焱 罗莎莉亚 胡桃 枫原万叶 烟绯 宵宫 托马 优菈 雷电将军 早柚
    珊瑚宫心海 五郎 九条裟罗 荒泷一斗 八重神子 鹿野院平藏 夜兰 绮良良 埃洛伊 申鹤
    云堇 久岐忍 神里绫人 柯莱 多莉 提纳里 妮露 赛诺 坎蒂丝 纳西妲 莱依拉 流浪者
    珐露珊 瑶瑶 艾尔海森 迪希雅 米卡 卡维 白术 琳妮特 林尼 菲米尼 莱欧斯利
    那维莱特 夏洛蒂 芙宁娜 夏沃蕾 娜维娅 嘉明 闲云 千织 希格雯 阿蕾奇诺 赛索斯
    克洛琳德 艾梅莉埃 卡齐娜 基尼奇 玛拉妮 希诺宁 恰斯卡 欧洛伦 玛薇卡 茜特菈莉
    蓝砚 梦见月瑞希 伊安珊 瓦雷莎 爱可菲 伊法 丝柯克 塔利雅 伊涅芙 奇偶·男性
    奇偶·女性 菈乌玛 菲林斯 爱诺 奈芙尔 杜林 雅珂达 哥伦比娅 兹白 叶洛亚 法尔伽
    洛恩 莉奈娅 尼可 布伦妮 桑多涅 旅行者
  `,
  starrail: `
    三月七 丹恒 姬子 瓦尔特 卡芙卡 银狼 阿兰 艾丝妲 黑塔 Saber Archer 布洛妮娅 希儿
    希露瓦 杰帕德 娜塔莎 佩拉 克拉拉 桑博 虎克 玲可 卢卡 托帕&账账 青雀 停云 罗刹
    景元 刃 素裳 驭空 符玄 彦卿 桂乃芬 白露 镜流 丹恒•饮月 雪衣 寒鸦 藿藿 椒丘
    飞霄 云璃 灵砂 貊泽 三月七·巡猎 忘归人 加拉赫 银枝 阮•梅 砂金 真理医生 花火
    黑天鹅 黄泉 知更鸟 流萤 米沙 星期日 翡翠 波提欧 乱破 大丽花 大黑塔 阿格莱雅
    缇宝 万敌 那刻夏 赛飞儿 遐蝶 白厄 风堇 海瑟音 刻律德菈 长夜月 丹恒•腾荒 昔涟
    火花 爻光 不死途 绯英 银狼LV.999 千冶•刃 远坂凛 吉尔伽美什 姬子•启行
    瓦尔特Pro 卡芙卡Pro 银狼Pro 希儿Pro 刃Pro 镜流Pro 藿藿Pro 花火Pro 黑天鹅Pro
    流萤Pro 穹·毁灭 星·毁灭 穹·存护 星·存护 穹·同谐 星·同谐 穹·记忆 星·记忆
    穹·欢愉 星·欢愉
  `,
  waves: `
    丹瑾 仇远 今汐 凌阳 千咲 卜灵 卡卡罗 卡提希娅 吟霖 嘉贝莉娜 坎特蕾拉 夏空
    奥古斯塔 守岸人 安可 尤诺 布兰特 弗洛洛 忌炎 折枝 散华 桃祈 椿 洛可可 渊武
    漂泊者·衍射 漂泊者·导电 漂泊者·热熔 漂泊者·冷凝 漂泊者·气动 漂泊者·湮灭
    漂泊者-女-气动 漂泊者-女-湮灭 漂泊者-女-衍射 漂泊者-女-冷凝 漂泊者-女-导电
    漂泊者-女-热熔 漂泊者-男-冷凝 漂泊者-男-导电 漂泊者-男-热熔 漂泊者-男-气动
    漂泊者-男-湮灭 漂泊者-男-衍射 灯灯 炽霞 爱弥斯 珂莱塔 琳奈 白芷 相里要 秋水
    秧秧 维里奈 莫宁 莫特斐 菲比 赞妮 釉瑚 鉴心 长离 陆·赫斯 露帕 西格莉卡 绯雪
    达妮娅 露西 丽贝卡 秧秧·玄翎 穗穗 清宵 景燃 锁暝 心
  `,
  zzz: `
    蕾米埃尔·丹 诺姆·霍洛维尔 维琳娜·艾嘉德 星徽·比利 普罗米娅 希希芙 南宫羽
    爱芮 千夏 照 叶瞬光 般岳 琉音 伊德海莉 狛野真斗 卢西娅 奥菲丝&「鬼火」 「席德」
    爱丽丝 浮波柚叶 橘福福 潘引壶 仪玄 零号·安比 波可娜 雨果 「扳机」 薇薇安
    伊芙琳 耀嘉音 「11号」 艾莲 安东 本 比利 苍角 格莉丝 珂蕾妲 猫又 妮可 朱鸢
    丽娜 莱卡恩 安比 可琳 雅 露西 莱特 悠真 柳 青衣 赛斯 派派 简 凯撒 柏妮思 哲 铃
  `,
}

const BUILTIN_ALIASES = {
  genshin: {
    枫原万叶: ["万叶"],
    雷电将军: ["雷神", "影", "阿影"],
    珊瑚宫心海: ["心海"],
    纳西妲: ["草神", "小草神"],
    芙宁娜: ["水神", "芙芙"],
    阿蕾奇诺: ["仆人"],
    玛薇卡: ["火神"],
    那维莱特: ["那维", "水龙王"],
    荒泷一斗: ["一斗"],
    八重神子: ["神子"],
    达达利亚: ["鸭鸭"],
  },
  starrail: {
    遐蝶: ["瑕蝶", "夏蝶", "霞蝶", "蝶宝", "小蝶"],
    "丹恒•饮月": ["饮月", "饮月君", "丹恒饮月"],
    "阮•梅": ["阮梅"],
    "托帕&账账": ["托帕", "账账"],
    "三月七·巡猎": ["巡猎三月七", "仙舟三月七"],
    忘归人: ["大停云"],
    真理医生: ["真理", "拉帝奥"],
    流萤: ["萨姆"],
    布洛妮娅: ["鸭鸭"],
  },
  waves: {
    今汐: ["今夕", "汐汐"],
    守岸人: ["守夜人", "岸宝"],
    长离: ["长璃"],
    安可: ["安科"],
    相里要: ["里哥"],
    鉴心: ["剑心"],
    忌炎: ["将军"],
    秧秧·玄翎: ["玄翎", "秧秧玄翎"],
  },
  zzz: {
    雅: ["星见雅", "星见"],
    "「11号」": ["11号", "十一号"],
    零号·安比: ["零号安比", "大安比"],
    艾莲: ["艾莲乔", "鲨鱼妹"],
    悠真: ["浅羽悠真", "浅羽"],
    柳: ["月城柳", "月城"],
    耀嘉音: ["嘉音"],
    "「扳机」": ["扳机"],
    "「席德」": ["席德"],
  },
}

function namesFromBlock(value) {
  return String(value || "").trim().split(/\s+/).filter(Boolean)
}

function normalizeCharacterName(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[•・.]/g, "·")
    .replace(/[「」『』"'`]/g, "")
    .replace(/[\s_-]+/g, "")
}

function normalizeQueryText(value) {
  return normalizeCharacterName(value).replace(
    /[，。！？、；：,.!?;:（）()\[\]【】<>《》~～#]/g,
    "",
  )
}

function stripGameAndRoleWords(value) {
  return String(value || "")
    .trim()
    .replace(/^[#~～\s]*/, "")
    .replace(
      /^(原神|genshin|鸣潮|星铁|星穹铁道|崩坏[:：·\s]*星穹铁道|绝区零|绝区|zzz)\s*/i,
      "",
    )
    .replace(/\s*(?:的)?(?:角色|人物|共鸣者|代理人)\s*$/i, "")
    .trim()
}

function splitAliasValue(value) {
  if (Array.isArray(value)) return value.map(String).map(item => item.trim()).filter(Boolean)
  return String(value || "").split(/[,|]+/).map(item => item.trim()).filter(Boolean)
}

function gameListLabel(games) {
  return [...games].map(game => GAME_LABELS[game] || game).join("、")
}

export class CharacterRegistry {
  constructor({ logger = console } = {}) {
    this.logger = logger
    this.records = new Map()
    this.lookup = new Map()
    this.searchTerms = []
    this.dirty = false
    this.loadedRoots = new Set()

    for (const [game, block] of Object.entries(BUILTIN_CHARACTER_NAMES)) {
      for (const name of namesFromBlock(block)) this.add(game, name)
    }
    for (const [game, entries] of Object.entries(BUILTIN_ALIASES)) {
      for (const [name, aliases] of Object.entries(entries)) this.add(game, name, aliases)
    }
  }

  add(game, character, aliases = []) {
    if (!GAME_LABELS[game]) return
    const canonical = String(character || "").trim()
    if (!canonical) return

    const key = `${game}\0${canonical}`
    let record = this.records.get(key)
    if (!record) {
      record = { game, character: canonical, aliases: new Set() }
      this.records.set(key, record)
    }

    for (const [name, isCanonical] of [
      [canonical, true],
      ...splitAliasValue(aliases).map(alias => [alias, false]),
    ]) {
      const normalized = normalizeCharacterName(name)
      if (!normalized) continue
      record.aliases.add(String(name))

      let matches = this.lookup.get(normalized)
      if (!matches) {
        matches = new Map()
        this.lookup.set(normalized, matches)
      }
      const previous = matches.get(key)
      matches.set(key, {
        game,
        character: canonical,
        matched: String(name),
        canonical: Boolean(isCanonical || previous?.canonical),
      })
    }

    this.dirty = true
  }

  resolve(value, { games = Object.keys(GAME_LABELS) } = {}) {
    const input = stripGameAndRoleWords(value)
    const normalized = normalizeCharacterName(input)
    const allowed = new Set(games)
    const matches = [...(this.lookup.get(normalized)?.values() || [])].filter(item =>
      allowed.has(item.game),
    )

    if (matches.length === 1) return { ok: true, ...matches[0], input }
    if (matches.length > 1) {
      return {
        ok: false,
        reason: "ambiguous",
        error: `角色别名“${input}”同时对应多个角色，请使用完整名称`,
        matches,
      }
    }
    return {
      ok: false,
      reason: "not_found",
      error: `角色“${input || value}”不在${gameListLabel(allowed)}角色白名单中`,
      matches: [],
    }
  }

  findInText(value, { explicitGames = [] } = {}) {
    this.refreshSearchTerms()
    const text = normalizeQueryText(value)
    if (!text) return []

    const results = []
    let longest = 0
    for (const term of this.searchTerms) {
      if (term.normalized.length < longest) break
      if (!text.includes(term.normalized)) continue
      if (
        term.normalized.length === 1 &&
        !explicitGames.length &&
        !new RegExp(
          `${term.normalized}(?:的)?(?:面板|攻略|图鉴|培养|遗器|圣遗物|武器|伤害|角色)`,
        ).test(text)
      ) {
        continue
      }
      longest = term.normalized.length
      results.push(...term.matches)
    }

    const explicit = new Set(explicitGames)
    const explicitMatches = results.filter(item => explicit.has(item.game))
    const selected = explicitMatches.length ? explicitMatches : results
    const unique = new Map()
    for (const item of selected) {
      unique.set(`${item.game}\0${item.character}`, item)
    }
    return [...unique.values()].slice(0, 8)
  }

  analyze(value) {
    const text = String(value || "")
    const explicitGames = Object.entries(GAME_PATTERNS)
      .filter(([, pattern]) => pattern.test(text))
      .map(([game]) => game)
    const characters = this.findInText(text, { explicitGames })
    const inferredGames = [...new Set(characters.map(item => item.game))]
    const explicit = new Set(explicitGames)
    const inferred = new Set(inferredGames)
    const conflict =
      explicit.size > 0 &&
      inferred.size > 0 &&
      ![...explicit].some(game => inferred.has(game))

    return {
      explicitGames,
      inferredGames,
      conflict,
      ambiguous: inferredGames.length > 1,
      characters: characters.map(({ game, character, matched }) => ({
        game,
        gameLabel: GAME_LABELS[game],
        character,
        matched,
      })),
    }
  }

  async loadInstalledPresets(cwd = process.cwd(), { force = false } = {}) {
    const root = path.resolve(cwd)
    if (!force && this.loadedRoots.has(root)) return
    this.loadedRoots.add(root)

    await Promise.all([
      this.loadMiao(path.join(root, "plugins", "miao-plugin")),
      this.loadYamlAliases(
        path.join(root, "plugins", "waves-plugin", "resources", "Alias", "role.yaml"),
        "waves",
      ),
      this.loadYamlAliases(
        path.join(root, "plugins", "ZZZ-Plugin", "defSet", "alias.yaml"),
        "zzz",
      ),
    ])
  }

  async loadMiao(pluginPath) {
    for (const [suffix, game] of [
      ["gs", "genshin"],
      ["sr", "starrail"],
    ]) {
      const directory = path.join(pluginPath, "resources", `meta-${suffix}`, "character")
      try {
        const raw = await fs.readFile(path.join(directory, "data.json"), "utf8")
        const data = JSON.parse(raw)
        for (const item of Object.values(data)) {
          if (item?.name) this.add(game, item.name)
        }

        const aliasPath = path.join(directory, "alias.js")
        const stat = await fs.stat(aliasPath)
        const url = `${pathToFileURL(aliasPath).href}?aiEnhance=${stat.mtimeMs}`
        const aliasModule = await import(url)
        for (const [name, aliases] of Object.entries(aliasModule.alias || {})) {
          this.add(game, name, aliases)
        }
      } catch (error) {
        if (error?.code !== "ENOENT") {
          this.logger.warn?.(
            `[aiEnhance-plugin] 读取 miao-plugin ${game} 角色预设失败：${error.message}`,
          )
        }
      }
    }
  }

  async loadYamlAliases(file, game) {
    try {
      const entries = YAML.parse(await fs.readFile(file, "utf8"))
      for (const [name, aliases] of Object.entries(entries || {})) {
        this.add(game, name, aliases)
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        this.logger.warn?.(
          `[aiEnhance-plugin] 读取 ${GAME_LABELS[game]}角色预设失败：${error.message}`,
        )
      }
    }
  }

  refreshSearchTerms() {
    if (!this.dirty) return
    this.searchTerms = [...this.lookup.entries()]
      .map(([normalized, matches]) => ({
        normalized,
        matches: [...matches.values()],
      }))
      .filter(item => {
        if (/^[a-z0-9]+$/i.test(item.normalized)) return item.normalized.length >= 4
        return item.normalized.length >= 1
      })
      .sort((left, right) => right.normalized.length - left.normalized.length)
    this.dirty = false
  }
}

export const characterRegistry = new CharacterRegistry()

export function resolveWhitelistedCharacter(value, games) {
  const result = characterRegistry.resolve(value, { games })
  if (!result.ok) throw new Error(result.error)
  return result
}

export {
  BUILTIN_CHARACTER_NAMES,
  BUILTIN_ALIASES,
  GAME_PATTERNS,
  normalizeCharacterName,
  normalizeQueryText,
  stripGameAndRoleWords,
  splitAliasValue,
  gameListLabel,
}
