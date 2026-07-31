export class RequestGate {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now
    this.requests = new Map()
    this.activeKeys = new Set()
    this.globalActive = 0
    this.acquireCount = 0
  }

  pruneExpired(now, windowMs) {
    for (const [key, timestamps] of this.requests) {
      const active = timestamps.filter(timestamp => now - timestamp < windowMs)
      if (active.length || this.activeKeys.has(key)) this.requests.set(key, active)
      else this.requests.delete(key)
    }
  }

  acquire(key, limits) {
    const now = this.now()
    const windowMs = limits.perUserWindowSeconds * 1_000
    // 公共机器人会接触大量一次性用户，定期清理已过窗口的桶，避免 Map 持续增长。
    if (++this.acquireCount % 100 === 0) this.pruneExpired(now, windowMs)

    const history = (this.requests.get(key) || []).filter(
      timestamp => now - timestamp < windowMs,
    )

    if (this.activeKeys.has(key)) {
      return { ok: false, reason: "user_busy", retryAfterMs: 1_000 }
    }

    if (history.length >= limits.perUserRequests) {
      const retryAfterMs = Math.max(1, windowMs - (now - history[0]))
      this.requests.set(key, history)
      return { ok: false, reason: "rate_limited", retryAfterMs }
    }

    if (this.globalActive >= limits.globalConcurrency) {
      return { ok: false, reason: "global_busy", retryAfterMs: 1_000 }
    }

    history.push(now)
    this.requests.set(key, history)
    this.activeKeys.add(key)
    this.globalActive++

    let released = false
    return {
      ok: true,
      release: () => {
        if (released) return
        released = true
        this.activeKeys.delete(key)
        this.globalActive = Math.max(0, this.globalActive - 1)
      },
    }
  }
}
