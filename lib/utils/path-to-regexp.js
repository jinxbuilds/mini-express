'use strict';

/**
 * Compile an Express-style path into a regular expression.
 *
 * Supported syntax:
 *   /users/:id        named parameter
 *   /users/:id?       optional parameter
 *   /files/*          wildcard (captured as params[0], params[1], ...)
 *   /file.:ext        parameters can follow literal text
 *   RegExp            used as-is (capture groups become params[0..n])
 *
 * @param {string|RegExp} path
 * @param {{ end?: boolean, strict?: boolean, sensitive?: boolean }} [options]
 * @returns {{ regexp: RegExp, keys: Array<{ name: string|number, optional: boolean }> }}
 */
function pathToRegexp(path, options = {}) {
  const { end = true, strict = false, sensitive = false } = options;
  const keys = [];

  if (path instanceof RegExp) {
    const groups = new RegExp(path.source + '|').exec('').length - 1;
    for (let i = 0; i < groups; i++) keys.push({ name: i, optional: false });
    return { regexp: path, keys };
  }

  let pattern = '';
  let wildcard = 0;
  let i = 0;

  while (i < path.length) {
    const ch = path[i];

    if (ch === ':' || (ch === '/' && path[i + 1] === ':')) {
      const leadingSlash = ch === '/';
      const start = i + (leadingSlash ? 2 : 1);
      const name = /^\w+/.exec(path.slice(start));
      if (!name) throw new TypeError(`Missing parameter name at position ${i} in "${path}"`);

      i = start + name[0].length;
      const optional = path[i] === '?';
      if (optional) i++;

      keys.push({ name: name[0], optional });
      const capture = '([^/]+?)';
      if (leadingSlash) pattern += optional ? `(?:/${capture})?` : `/${capture}`;
      else pattern += optional ? `${capture}?` : capture;
      continue;
    }

    if (ch === '*') {
      keys.push({ name: wildcard++, optional: true });
      pattern += '(.*)';
      i++;
      continue;
    }

    pattern += escape(ch);
    i++;
  }

  // Non-strict mode treats "/users" and "/users/" as the same path.
  if (!strict) pattern = pattern.replace(/\/$/, '') + '/?';

  // `end: false` is used by app.use() — match the path as a prefix,
  // but only on a segment boundary ("/api" matches "/api/x", not "/apiary").
  pattern += end ? '$' : '(?=/|$)';

  return { regexp: new RegExp('^' + pattern, sensitive ? '' : 'i'), keys };
}

function escape(ch) {
  return /[.+^${}()|[\]\\?]/.test(ch) ? '\\' + ch : ch;
}

module.exports = pathToRegexp;
