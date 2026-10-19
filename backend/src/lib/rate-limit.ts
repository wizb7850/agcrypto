import { HttpError } from './errors.js';

/**
 * Limiteur de tentatives en mémoire (fenêtre fixe).
 * Suffisant pour une seule instance ; à remplacer par Redis si l'API tourne sur plusieurs serveurs.
 */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  constructor(private max: number, private windowMs: number, private message: string) {}

  /** Refuse si la limite est atteinte, sinon compte la tentative. */
  consume(key: string) {
    this.check(key);
    this.hit(key);
  }

  check(key: string) {
    const h = this.hits.get(key);
    if (h && h.resetAt > Date.now() && h.count >= this.max) {
      throw new HttpError(429, 'too_many_requests', this.message);
    }
  }

  hit(key: string) {
    const now = Date.now();
    const h = this.hits.get(key);
    if (!h || h.resetAt <= now) this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
    else h.count++;
    if (this.hits.size > 50_000) this.prune();
  }

  reset(key: string) {
    this.hits.delete(key);
  }

  private prune() {
    const now = Date.now();
    for (const [k, h] of this.hits) if (h.resetAt <= now) this.hits.delete(k);
  }
}
