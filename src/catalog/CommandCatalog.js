import { PRESET_COMMANDS, createCustomCandidate } from "./presets.js"
import { characterRegistry } from "./CharacterRegistry.js"

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[～]/g, "~")
    .replace(/[\s\p{P}\p{S}]+/gu, "")
}

function ngrams(value, size = 2) {
  const normalized = normalizeText(value)
  const result = new Set()
  if (!normalized) return result
  if (normalized.length <= size) {
    result.add(normalized)
    return result
  }
  for (let index = 0; index <= normalized.length - size; index++) {
    result.add(normalized.slice(index, index + size))
  }
  return result
}

function jaccard(left, right) {
  if (!left.size || !right.size) return 0
  let intersection = 0
  for (const item of left) if (right.has(item)) intersection++
  return intersection / (left.size + right.size - intersection)
}

function pluginHintScore(query, plugin) {
  if (plugin === "waves" && /(鸣潮|库街区|波片|声骸|共鸣者)/.test(query)) return 0.28
  if (
    plugin === "miao" &&
    /(喵喵|原神|星铁|星穹|铁道|绝区零|圣遗物|遗器|面板)/.test(query)
  ) {
    return 0.16
  }
  if (plugin === "genshin" && /(原神|提瓦特)/.test(query)) return 0.16
  if (plugin === "starrail" && /(星铁|星穹|铁道)/.test(query)) return 0.16
  if (plugin === "xiaoyao" && /(逍遥|原神|图鉴|树脂|便笺)/.test(query)) return 0.15
  return 0
}

function legacyGameConflictPenalty(query, candidate) {
  const games = new Set()
  if (/(鸣潮|库街区|波片|声骸|共鸣者)/.test(query)) games.add("waves")
  if (/(星铁|星穹|铁道)/.test(query)) games.add("starrail")
  if (/(绝区零|绝区)/.test(query)) games.add("zzz")
  if (/(原神|提瓦特|树脂|圣遗物)/.test(query)) games.add("genshin")
  if (games.size !== 1) return 0

  const [game] = games
  if (game === "waves") return candidate.plugin === "waves" ? 0 : 0.3
  if (candidate.plugin === "waves") return 0.25

  if (game === "starrail") {
    if (candidate.id.includes("genshin") || candidate.id.includes("zzz")) return 0.22
  }
  if (game === "zzz") {
    if (candidate.id.includes("genshin") || candidate.id.includes("starrail")) return 0.22
  }
  if (game === "genshin") {
    if (candidate.id.includes("starrail") || candidate.id.includes("zzz")) return 0.22
  }
  return 0
}

function hintedGame(context) {
  if (context.explicitGames.length === 1) return context.explicitGames[0]
  if (!context.explicitGames.length && context.inferredGames.length === 1) {
    return context.inferredGames[0]
  }
  return ""
}

function gameCompatibility(context, candidate) {
  const game = hintedGame(context)
  const supported = Array.isArray(candidate.games) ? candidate.games : []
  if (!game || !supported.length) return { excluded: false, bonus: 0 }
  if (!supported.includes(game)) return { excluded: true, bonus: 0 }

  const acceptsCharacter = Boolean(
    candidate.characterSlot || candidate.characterTopicSlot,
  )
  return {
    excluded: false,
    bonus: context.characters.length ? (acceptsCharacter ? 0.36 : 0) : 0.18,
  }
}

function gameConflictPenalty(query, candidate, context = characterRegistry.analyze(query)) {
  const compatibility = gameCompatibility(context, candidate)
  if (compatibility.excluded) return 1
  if (candidate.games?.length) return 0
  return legacyGameConflictPenalty(query, candidate)
}

function scoreCandidate(
  query,
  candidate,
  context = characterRegistry.analyze(query),
) {
  const normalizedQuery = normalizeText(query)
  if (!normalizedQuery) return { score: 0, matchedTerms: [] }

  let score = pluginHintScore(query, candidate.plugin)
  const matchedTerms = []
  const compatibility = gameCompatibility(context, candidate)
  if (compatibility.excluded) {
    return { score: 0, matchedTerms, excludedByGame: true }
  }
  score += compatibility.bonus

  for (const keyword of candidate.keywords) {
    const normalizedKeyword = normalizeText(keyword)
    if (normalizedKeyword && normalizedQuery.includes(normalizedKeyword)) {
      score += normalizedKeyword.length >= 3 ? 0.16 : 0.1
      matchedTerms.push(keyword)
    }
  }

  const queryGrams = ngrams(query)
  let bestSimilarity = 0
  const phrases = [
    candidate.description,
    ...candidate.intentExamples,
    ...candidate.commandExamples,
  ]

  for (const phrase of phrases) {
    const normalizedPhrase = normalizeText(phrase)
    if (!normalizedPhrase) continue
    if (
      normalizedQuery === normalizedPhrase ||
      (normalizedPhrase.length >= 3 && normalizedQuery.includes(normalizedPhrase))
    ) {
      bestSimilarity = Math.max(bestSimilarity, 1)
    } else {
      bestSimilarity = Math.max(bestSimilarity, jaccard(queryGrams, ngrams(phrase)))
    }
  }

  score += bestSimilarity * 0.55
  score -= gameConflictPenalty(query, candidate, context)
  return {
    score: Math.max(0, Math.min(1, Number(score.toFixed(4)))),
    matchedTerms: [...new Set(matchedTerms)].slice(0, 8),
    excludedByGame: false,
  }
}

function slotsToObject(candidate, slotList) {
  const allowed = new Map(candidate.slots.map(slot => [slot.name, slot]))
  const result = {}

  for (const slot of slotList || []) {
    if (!allowed.has(slot.name)) throw new Error(`候选不接受参数 ${slot.name}`)
    result[slot.name] = slot.value
  }

  for (const slot of candidate.slots) {
    const value = String(result[slot.name] ?? "").trim()
    if (slot.required && !value) throw new Error(`缺少参数：${slot.description}`)
    if (value && slot.allowedValues && !slot.allowedValues.includes(value)) {
      throw new Error(`${slot.name} 只能是：${slot.allowedValues.join("、")}`)
    }
  }

  return result
}

function regexMatches(regex, value) {
  if (!(regex instanceof RegExp)) return false
  regex.lastIndex = 0
  const result = regex.test(value)
  regex.lastIndex = 0
  return result
}

function runtimeEntryMatches(entry, aliases) {
  const haystack = `${entry.key || ""} ${entry.name || ""} ${entry.plugin?.name || ""}`.toLowerCase()
  return aliases.some(alias => haystack.includes(String(alias).toLowerCase()))
}

export class CommandCatalog {
  constructor({ logger = console, cwd = process.cwd() } = {}) {
    this.logger = logger
    this.cwd = cwd
    this.candidates = []
    this.byId = new Map()
    this.signature = ""
  }

  configure(commandsConfig = {}) {
    const signature = JSON.stringify({
      enabledPresets: commandsConfig.enabledPresets,
      disabledIds: commandsConfig.disabledIds,
      custom: commandsConfig.custom,
    })
    if (signature === this.signature) return

    const enabledPresets = new Set(commandsConfig.enabledPresets || [])
    const disabledIds = new Set(commandsConfig.disabledIds || [])
    const candidates = []

    for (const [preset, entries] of Object.entries(PRESET_COMMANDS)) {
      if (!enabledPresets.has(preset)) continue
      for (const entry of entries) if (!disabledIds.has(entry.id)) candidates.push(entry)
    }

    for (const custom of commandsConfig.custom || []) {
      const entry = createCustomCandidate(custom)
      if (!entry) {
        this.logger.warn?.("[aiEnhance-plugin] 跳过无效的 commands.custom 项")
        continue
      }
      if (!disabledIds.has(entry.id)) candidates.push(entry)
    }

    this.candidates = candidates
    this.byId = new Map(candidates.map(candidate => [candidate.id, candidate]))
    this.signature = signature
  }

  get size() {
    return this.candidates.length
  }

  find(id) {
    return this.byId.get(id) || null
  }

  async prepare({ force = false } = {}) {
    await characterRegistry.loadInstalledPresets(this.cwd, { force })
  }

  analyze(query) {
    return characterRegistry.analyze(query)
  }

  rank(query, { context } = {}) {
    const queryContext = context || this.analyze(query)
    return this.candidates
      .map(candidate => ({
        candidate,
        ...scoreCandidate(query, candidate, queryContext),
      }))
      .filter(result => !result.excludedByGame)
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.candidate.id.localeCompare(right.candidate.id),
      )
  }

  search(query, { topK = 12, minimumScore = 0.04, context } = {}) {
    return this.rank(query, { context })
      .filter(result => result.score >= minimumScore)
      .slice(0, topK)
  }

  buildCommand(candidateId, slotList = [], options = {}) {
    const candidate = this.find(candidateId)
    if (!candidate) return { ok: false, error: "候选命令不存在" }

    try {
      const slots = slotsToObject(candidate, slotList)
      const command = String(candidate.build(slots, options) || "").trim()
      if (!command || command.length > 200 || /[\r\n]/.test(command)) {
        return { ok: false, error: "生成的命令无效" }
      }
      if (!regexMatches(candidate.validateCommand, command)) {
        return { ok: false, error: "生成命令未通过本地模板校验" }
      }
      return { ok: true, candidate, command, slots }
    } catch (error) {
      return { ok: false, candidate, error: error.message }
    }
  }

  validateRuntime(candidate, command, pluginLoader, event) {
    if (!candidate || !regexMatches(candidate.validateCommand, command)) {
      return { ok: false, reason: "生成命令未通过候选模板校验" }
    }

    if (!pluginLoader || !Array.isArray(pluginLoader.priority)) {
      return { ok: false, reason: "当前 Yunzai 未暴露插件调度器" }
    }

    const aliases = candidate.runtimeAliases || [candidate.plugin]
    const installedEntries = pluginLoader.priority.filter(entry =>
      runtimeEntryMatches(entry, aliases),
    )
    if (!installedEntries.length) {
      return { ok: false, reason: `未检测到 ${candidate.plugin} 插件` }
    }

    const entries = installedEntries.filter(entry => {
      if (!event || typeof pluginLoader.checkDisable !== "function") return true
      try {
        // Yunzai 自身会把事件临时挂到已加载的插件实例上。这里只做预检，
        // 使用原型代理继承插件信息，避免并发请求互相覆盖 entry.plugin.e。
        const pluginView = Object.assign(Object.create(entry.plugin), { e: event })
        return pluginLoader.checkDisable(pluginView)
      } catch {
        // 框架会在真实重派发时再次检查；此处不因版本差异误判为禁用。
        return true
      }
    })
    if (!entries.length) {
      return { ok: false, reason: `当前群已禁用 ${candidate.plugin} 插件` }
    }

    if (candidate.runtimeRuleOptional) return { ok: true }

    for (const entry of entries) {
      for (const rule of entry.plugin?.rule || []) {
        if (regexMatches(rule.reg, command)) return { ok: true }
      }
    }

    return {
      ok: false,
      reason: "目标插件已加载，但当前版本没有匹配生成命令的规则",
    }
  }
}

export {
  normalizeText,
  ngrams,
  jaccard,
  pluginHintScore,
  legacyGameConflictPenalty,
  hintedGame,
  gameCompatibility,
  gameConflictPenalty,
  scoreCandidate,
  slotsToObject,
  regexMatches,
  runtimeEntryMatches,
}
