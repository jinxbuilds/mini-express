'use strict';

/**
 * Fixed-window rate limiter keyed by client IP. Sets the standard
 * RateLimit-* headers and answers 429 once the budget is spent.
 */
function rateLimit({ windowMs = 60_000, max = 100 } = {}) {
  const hits = new Map();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.reset <= now) hits.delete(key);
  }, windowMs);
  sweep.unref();

  return function limiter(req, res, next) {
    const now = Date.now();
    let entry = hits.get(req.ip);
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(req.ip, entry);
    }
    entry.count++;

    const remaining = Math.max(0, max - entry.count);
    const resetSeconds = Math.ceil((entry.reset - now) / 1000);
    res.set({
      'RateLimit-Limit': max,
      'RateLimit-Remaining': remaining,
      'RateLimit-Reset': resetSeconds,
    });

    if (entry.count > max) {
      res.set('Retry-After', resetSeconds);
      return res.status(429).json({ error: { status: 429, message: 'Too many requests, slow down.' } });
    }
    next();
  };
}

module.exports = rateLimit;
