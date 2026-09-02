const NEVER_EXECUTE_RISKS = new Set(["sensitive", "admin"])

function selectedRetrievalStats(candidateId, searchResults) {
  const selected = searchResults.find(result => result.candidate.id === candidateId)
  if (!selected) return { selectedScore: 0, margin: 0 }

  const runnerUp = searchResults
    .filter(result => result.candidate.id !== candidateId)
    .reduce((maximum, result) => Math.max(maximum, result.score), 0)

  return {
    selectedScore: selected.score,
    margin: selected.score - runnerUp,
  }
}

function autoExecuteBlockReason({
  route,
  candidate,
  selectedScore,
  margin,
  config,
}) {
  if (candidate.risk === "write") return "side_effect_requires_confirmation"
  if (candidate.risk !== "read" || candidate.autoExecute !== true) {
    return "candidate_requires_confirmation"
  }
  if (!config.routing.autoExecuteEnabled) return "auto_execute_disabled"

  const allowlist = new Set(config.commands.autoExecuteAllowlist || [])
  if (!allowlist.has(candidate.id)) return "candidate_not_allowlisted"
  if (route.confidence < config.routing.autoExecuteConfidence) {
    return "confidence_below_auto_threshold"
  }
  if (selectedScore < config.routing.minAutoRetrievalScore) {
    return "retrieval_score_below_auto_threshold"
  }
  if (margin < config.routing.minAutoRetrievalMargin) {
    return "retrieval_margin_below_auto_threshold"
  }
  return ""
}

export class PolicyEngine {
  decide({ route, candidate, searchResults, config, queryContext }) {
    if (!candidate) return { action: "clarify", reason: "candidate_missing" }

    if (NEVER_EXECUTE_RISKS.has(candidate.risk)) {
      return { action: "deny", reason: `risk_${candidate.risk}` }
    }

    if (queryContext?.conflict) {
      return { action: "clarify", reason: "query_game_conflict" }
    }

    if (queryContext?.ambiguous) {
      return { action: "clarify", reason: "query_character_ambiguous" }
    }

    const { selectedScore, margin } = selectedRetrievalStats(
      candidate.id,
      searchResults,
    )

    if (route.confidence < config.routing.confirmConfidence) {
      return {
        action: "clarify",
        reason: "confidence_too_low",
        selectedScore,
        margin,
      }
    }

    if (margin < 0) {
      return {
        action: "clarify",
        reason: "candidate_ranked_below_alternative",
        selectedScore,
        margin,
      }
    }

    const blockReason = autoExecuteBlockReason({
      route,
      candidate,
      selectedScore,
      margin,
      config,
    })

    if (!blockReason) {
      return {
        action: "execute",
        reason: "safe_high_confidence",
        selectedScore,
        margin,
      }
    }

    return {
      action: "confirm",
      reason: blockReason,
      selectedScore,
      margin,
    }
  }
}

export {
  NEVER_EXECUTE_RISKS,
  selectedRetrievalStats,
  autoExecuteBlockReason,
}
