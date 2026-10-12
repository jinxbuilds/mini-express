'use strict';

const bodyParser = require('./read-body');

/**
 * Parse `application/json` (and `*+json`) bodies into req.body.
 * Invalid JSON becomes a 400 error passed to next().
 *
 * @param {{ limit?: string|number, strict?: boolean }} [options]
 *   strict (default true): only accept objects and arrays at the top level.
 */
function json({ limit = '100kb', strict = true } = {}) {
  return bodyParser({
    limit,
    matches: (type) => type === 'application/json' || type.endsWith('+json'),
    parse(raw) {
      if (raw.trim() === '') return {};
      if (strict && !/^\s*[[{]/.test(raw)) {
        throw new SyntaxError('Invalid JSON: top-level value must be an object or array');
      }
      try {
        return JSON.parse(raw);
      } catch (err) {
        throw new SyntaxError(`Invalid JSON: ${err.message}`);
      }
    },
  });
}

module.exports = json;
