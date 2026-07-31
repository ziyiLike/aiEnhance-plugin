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

    const allowlist = new Set(config.commands.autoExecuteAllowlist || [])
    const canAutoExecute =
      config.routing.autoExecuteEnabled &&
      candidate.risk === "read" &&
      candidate.autoExecute === true &&
      allowlist.has(candidate.id) &&
      route.confidence >= config.routing.autoExecuteConfidence &&
      selectedScore >= config.routing.minAutoRetrievalScore &&
      margin >= config.routing.minAutoRetrievalMargin

    if (canAutoExecute) {
      return {
        action: "execute",
        reason: "safe_high_confidence",
        selectedScore,
        margin,
      }
    }

    return {
      action: "confirm",
      reason: candidate.risk === "write" ? "side_effect_requires_confirmation" : "not_auto_safe",
      selectedScore,
      margin,
    }
  }
}

export { NEVER_EXECUTE_RISKS, selectedRetrievalStats }
