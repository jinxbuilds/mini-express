'use strict';

const crypto = require('crypto');

const COLORS = { 2: 32, 3: 36, 4: 33, 5: 31 };

/**
 * Tags each request with an X-Request-Id, measures it (X-Response-Time),
 * and logs a one-line summary when the response finishes.
 */
function observability({ log = true } = {}) {
  return function observe(req, res, next) {
    const start = process.hrtime.bigint();
    const id = req.get('X-Request-Id') || crypto.randomUUID().slice(0, 8);
    req.id = id;
    res.set('X-Request-Id', id);

    // Headers must be set before they're flushed, so patch writeHead.
    const writeHead = res.writeHead;
    res.writeHead = function (...args) {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      if (!res.headersSent) res.setHeader('X-Response-Time', `${ms.toFixed(2)}ms`);
      return writeHead.apply(this, args);
    };

    if (log) {
      res.on('finish', () => {
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        const color = COLORS[String(res.statusCode)[0]] || 0;
        console.log(
          `\x1b[90m${id}\x1b[0m ${req.method.padEnd(6)} ${req.originalUrl} `
          + `\x1b[${color}m${res.statusCode}\x1b[0m \x1b[90m${ms.toFixed(1)}ms\x1b[0m`,
        );
      });
    }
    next();
  };
}

module.exports = observability;
