const GUIDE_CANDIDATES = {
  genshin: "genshin.guide",
  starrail: "starrail.guide",
  waves: "waves.guide",
}

// “看看角色攻略”仍走原有命令路由；只有需要从攻略中提炼具体结论的问句
// 才进入知识问答，避免每次查看攻略都额外消耗一次视觉模型调用。
const KNOWLEDGE_TOPIC_PATTERN =
  /(圣遗物|遗器|武器|光锥|专武|声骸|音擎|驱动盘|配装|装备|套装|词条|属性|面板|配队|队伍|队友|技能|天赋|加点|命座|星魂|共鸣链|影画|养成|培养|毕业)/

const QUESTION_PATTERN =
  /(怎么|如何|什么|哪些|哪个|哪套|哪把|推荐|选择|优先|替代|平替|没有|没抽|没带|带啥|带什么|用啥|用什么|能用|该用|该带|该配|怎么配|怎么堆|堆多少|要多少|多少合适|值不值得|要不要)/

export function isCharacterKnowledgeQuestion(text) {
  const value = String(text || "").trim()
  if (!value || /^[#*~～]/.test(value)) return false
  return KNOWLEDGE_TOPIC_PATTERN.test(value) && QUESTION_PATTERN.test(value)
}

export function detectCharacterKnowledgeIntent({ text, context, catalog }) {
  if (!isCharacterKnowledgeQuestion(text)) return null
  if (
    !context ||
    context.conflict ||
    context.ambiguous ||
    context.characters?.length !== 1
  ) {
    return null
  }

  const character = context.characters[0]
  const candidateId = GUIDE_CANDIDATES[character.game] || null
  let guide = null

  if (candidateId && catalog?.find(candidateId)) {
    const built = catalog.buildCommand(
      candidateId,
      [{ name: "character", value: character.character }],
      { context },
    )
    if (built.ok) {
      guide = {
        candidateId,
        candidate: built.candidate,
        command: built.command,
      }
    }
  }

  return {
    question: String(text).trim(),
    game: character.game,
    gameLabel: character.gameLabel,
    character: character.character,
    matched: character.matched,
    guide,
  }
}

export { GUIDE_CANDIDATES, KNOWLEDGE_TOPIC_PATTERN, QUESTION_PATTERN }
