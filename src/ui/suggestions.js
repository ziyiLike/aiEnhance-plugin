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
  return `我还不完全确定。你是想执行「${candidate.description}」吗？`
}
