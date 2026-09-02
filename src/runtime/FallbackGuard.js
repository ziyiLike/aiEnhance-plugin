const eligibleEvents = new WeakSet()

export function markAiFallbackEligible(event) {
  if (!event || typeof event !== "object") return false
  eligibleEvents.add(event)
  return true
}

export function consumeAiFallbackEligibility(event) {
  if (!event || typeof event !== "object" || !eligibleEvents.has(event)) {
    return false
  }

  eligibleEvents.delete(event)
  return true
}
