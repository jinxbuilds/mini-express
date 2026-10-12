'use strict';

const { createError, mimeOf } = require('../utils');

/** Parse "100kb", "1mb" or a number of bytes. */
function parseLimit(limit) {
  if (typeof limit === 'number') return limit;
  const m = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i.exec(String(limit).trim());
  if (!m) throw new TypeError(`Invalid limit: ${limit}`);
  const units = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };
  return Math.floor(Number(m[1]) * units[(m[2] || 'b').toLowerCase()]);
}

function hasBody(req) {
  return req.headers['transfer-encoding'] !== undefined
    || (req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0');
}

/**
 * Factory for body-parsing middleware. Reads the raw body (up to `limit`
 * bytes) when the Content-Type passes `matches`, then hands the text to `parse`.
 */
function bodyParser({ limit = '100kb', matches, parse }) {
  const maxBytes = parseLimit(limit);

  return function parseBody(req, res, next) {
    if (req._body) return next();
    req.body = req.body || {};

    if (!hasBody(req) || !matches(mimeOf(req.headers['content-type']))) return next();

    const declared = Number(req.headers['content-length']);
    if (declared > maxBytes) {
      req.resume();
      return next(createError(413, 'Request entity too large', { type: 'entity.too.large' }));
    }

    const chunks = [];
    let received = 0;
    let finished = false;

    const finish = (err) => {
      if (finished) return;
      finished = true;
      req.off('data', onData);
      if (err) {
        req.resume();
        return next(err);
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        req.body = parse(raw);
        req._body = true;
      } catch (parseError) {
        return next(createError(400, parseError.message, { type: 'entity.parse.failed', body: raw }));
      }
      next();
    };

    const onData = (chunk) => {
      received += chunk.length;
      if (received > maxBytes) {
        return finish(createError(413, 'Request entity too large', { type: 'entity.too.large' }));
      }
      chunks.push(chunk);
    };

    req.on('data', onData);
    req.on('end', () => finish());
    req.on('error', (err) => finish(createError(400, err.message)));
  };
}

module.exports = bodyParser;
