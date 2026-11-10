/** Fixed-window limiter keyed by caller. In-memory, so per process; see docs/roadmap.md for a shared store. */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Returns seconds to wait when limited, or 0 when allowed. */
  check(key: string): number {
    const t = this.now();
    const h = this.hits.get(key);
    if (!h || h.resetAt <= t) {
      this.hits.set(key, { count: 1, resetAt: t + this.windowMs });
      return 0;
    }
    if (h.count >= this.limit) return Math.ceil((h.resetAt - t) / 1000);
    h.count++;
    return 0;
  }
}
