const SIGN_CANDIDATES = {
  genshin: "xiaoyao.genshin_sign",
  starrail: "xiaoyao.starrail_sign",
  zzz: "xiaoyao.zzz_sign",
  waves: "waves.sign",
}

const SIGN_HELP_CANDIDATES = {
  genshin: "xiaoyao.account_help",
  starrail: "xiaoyao.account_help",
  zzz: "xiaoyao.account_help",
  waves: "waves.login_help",
}

function fixedCandidateSuggestion(candidateId, catalog) {
  const candidate = catalog.find(candidateId)
  if (
    !candidate ||
    ["sensitive", "admin"].includes(candidate.risk) ||
    candidate.slots.some(slot => slot.required)
  ) {
    return null
  }
  const built = catalog.buildCommand(candidateId, [])
  if (!built.ok) return null
  return {
    description: candidate.description,
    command: built.command,
  }
}

export function fixedSuggestions(searchResults, catalog) {
  const suggestions = []
  for (const result of searchResults) {
    if (result.score < 0.18) continue
    if (result.candidate.slots.some(slot => slot.required)) continue
    const built = catalog.buildCommand(result.candidate.id, [])
    if (!built.ok) continue
    suggestions.push({
      description: result.candidate.description,
      command: built.command,
    })
  }
  return suggestions
}

export function modelAlternativeSuggestions(route, catalog) {
  const alternatives = Array.isArray(route?.alternatives)
    ? [...route.alternatives]
    : []
  alternatives.sort((left, right) => right.confidence - left.confidence)
  return alternatives
    .map(item => fixedCandidateSuggestion(item.candidateId, catalog))
    .filter(Boolean)
}

export function contextualSignSuggestions(context, text, catalog) {
  const query = String(text || "")
  if (!/签到/.test(query)) return []
  if (
    /(?:签到.{0,4}(?:记录|历史|状态)|(?:记录|历史|状态).{0,4}签到|米游币)/.test(
      query,
    )
  ) {
    return []
  }

  const explicitGames = Array.isArray(context?.explicitGames)
    ? context.explicitGames
    : []
  const inferredGames = Array.isArray(context?.inferredGames)
    ? context.inferredGames
    : []
  const defaultGames = /(?:米游社|米哈游|米游币)/.test(query)
    ? ["genshin", "starrail", "zzz"]
    : Object.keys(SIGN_CANDIDATES)
  const hintedGames = explicitGames.length
    ? explicitGames
    : inferredGames.length
      ? inferredGames
      : defaultGames
  const games = [...new Set(hintedGames)].filter(game => SIGN_CANDIDATES[game])
  const configurationIntent =
    /(?:自动签到|签到.{0,6}(?:配置|教程|帮助|设置)|(?:配置|教程|帮助|设置).{0,6}签到|cookie|stoken)/i.test(
      query,
    )
  const howToIntent =
    /(?:(?:怎么|如何).{0,8}签到|签到.{0,8}(?:怎么|如何))/.test(query)
  const suggestions = []

  if (!configurationIntent) {
    for (const game of games) {
      const suggestion = fixedCandidateSuggestion(SIGN_CANDIDATES[game], catalog)
      if (suggestion) suggestions.push(suggestion)
    }
  }

  if (configurationIntent || howToIntent) {
    for (const game of games) {
      const suggestion = fixedCandidateSuggestion(
        SIGN_HELP_CANDIDATES[game],
        catalog,
      )
      if (suggestion) suggestions.push(suggestion)
    }
  }

  return mergeSuggestions(suggestions)
}

export function contextualCharacterSuggestions(context, text, catalog) {
  if (
    !context ||
    context.conflict ||
    context.ambiguous ||
    context.characters?.length !== 1
  ) {
    return []
  }

  const { game, gameLabel, character } = context.characters[0]
  const suggestions = []
  const add = (candidateId, slots, description) => {
    if (!catalog.find(candidateId)) return
    const built = catalog.buildCommand(candidateId, slots)
    if (built.ok) suggestions.push({ description, command: built.command })
  }

  if (["genshin", "starrail"].includes(game)) {
    const guideCandidateId =
      game === "starrail" ? "starrail.guide" : "genshin.guide"
    const view =
      ["圣遗物", "遗器", "武器", "伤害", "详情"].find(item =>
        String(text || "").includes(item),
      ) || "面板"
    const addProfile = () =>
      add(
        "miao.profile_detail",
        [
          { name: "character", value: character },
          { name: "view", value: view },
        ],
        `${gameLabel}${character}${view}`,
      )
    const addGuide = () =>
      add(
        guideCandidateId,
        [{ name: "character", value: character }],
        `${gameLabel}${character}攻略`,
      )
    const addAtlas = () =>
      add(
        "xiaoyao.atlas",
        [{ name: "topic", value: character }],
        `${gameLabel}${character}图鉴`,
      )

    if (/(攻略|培养|配队)/.test(String(text || ""))) {
      addGuide()
      addProfile()
      addAtlas()
    } else if (/(图鉴|资料)/.test(String(text || ""))) {
      addAtlas()
      addProfile()
      addGuide()
    } else {
      addProfile()
      addGuide()
      addAtlas()
    }
  } else if (game === "waves") {
    add(
      "waves.profile",
      [{ name: "character", value: character }],
      `鸣潮${character}面板`,
    )
    add(
      "waves.guide",
      [{ name: "character", value: character }],
      `鸣潮${character}攻略`,
    )
    add(
      "waves.atlas",
      [{ name: "topic", value: character }],
      `鸣潮${character}图鉴`,
    )
  }

  return suggestions
}

export function hasCharacterCommandIntent(text) {
  return /(查询|查一下|看看|看下|面板|攻略|图鉴|培养|练度|遗器|圣遗物|武器|伤害)/.test(
    String(text || ""),
  )
}

export function mergeSuggestions(...groups) {
  const result = []
  const seen = new Set()
  for (const item of groups.flat()) {
    if (!item?.command || seen.has(item.command)) continue
    seen.add(item.command)
    result.push(item)
  }
  return result
}

export function commandSuggestions({
  route,
  context,
  text,
  searchResults,
  catalog,
  primary = [],
  includeLocalFallbacks = true,
}) {
  const signSuggestions = contextualSignSuggestions(context, text, catalog)
  const modelSuggestions = modelAlternativeSuggestions(route, catalog)

  if (signSuggestions.length) {
    return mergeSuggestions(signSuggestions, primary, modelSuggestions).slice(
      0,
      5,
    )
  }

  return mergeSuggestions(
    primary,
    modelSuggestions,
    includeLocalFallbacks
      ? contextualCharacterSuggestions(context, text, catalog)
      : [],
    includeLocalFallbacks ? fixedSuggestions(searchResults, catalog) : [],
  ).slice(0, 5)
}

export function modelClarification(route, buildError) {
  if (route.reply) return route.reply
  if (buildError) return `${buildError}。请补充更具体的信息。`
  return "我还不确定你想查询什么，请再具体一点。"
}

export function decisionClarification(decision, candidate) {
  if (decision.reason === "query_game_conflict") {
    return "你说的游戏和角色白名单不一致，请确认游戏或改用角色完整名称。"
  }
  if (decision.reason === "query_character_ambiguous") {
    return "这个角色名在多个游戏中都存在，请补充原神、鸣潮、星铁或绝区零。"
  }
  if (decision.reason === "candidate_ranked_below_alternative") {
    return "我找到了几个相近的功能，已经把直接操作排在前面，请选择你实际想用的一个。"
  }
  return `我还不完全确定。你是想执行「${candidate.description}」吗？`
}
