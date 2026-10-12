'use strict';

const pathToRegexp = require('../utils/path-to-regexp');
const { createError } = require('../utils');

/**
 * A Layer is one entry in a router's stack: a path matcher plus a handler.
 *
 * - Middleware layers (app.use) match a path *prefix*.
 * - Route layers (app.get, ...) match the full path and hold a `route`.
 */
class Layer {
  constructor(path, options, fn) {
    this.handle = fn;
    this.name = fn.name || '<anonymous>';
    this.params = undefined;
    this.path = undefined;
    this.route = undefined;
    this.method = undefined;

    const { regexp, keys } = pathToRegexp(path, options);
    this.regexp = regexp;
    this.keys = keys;

    // Fast path: `app.use(fn)` matches every request.
    this.matchAll = path === '/' && options.end === false;
  }

  /**
   * Test a pathname against this layer, populating `this.params` and
   * `this.path` (the matched portion) on success.
   */
  match(pathname) {
    if (this.matchAll) {
      this.params = {};
      this.path = '';
      return true;
    }

    const m = this.regexp.exec(pathname);
    if (!m) {
      this.params = undefined;
      this.path = undefined;
      return false;
    }

    this.params = {};
    this.path = m[0];

    for (let i = 0; i < this.keys.length; i++) {
      const value = m[i + 1];
      if (value !== undefined) this.params[this.keys[i].name] = decodeParam(value);
    }
    return true;
  }

  /** Run a regular handler `(req, res, next)`. Error handlers are skipped. */
  handleRequest(req, res, next) {
    if (this.handle.length > 3) return next();
    invoke(() => this.handle(req, res, next), next);
  }

  /** Run an error handler `(err, req, res, next)`. Regular handlers are skipped. */
  handleError(err, req, res, next) {
    if (this.handle.length !== 4) return next(err);
    invoke(() => this.handle(err, req, res, next), next);
  }
}

/**
 * Call a handler, forwarding both thrown errors and rejected promises to
 * `next` — so `async (req, res) => { throw ... }` just works.
 */
function invoke(call, next) {
  try {
    const result = call();
    if (result && typeof result.then === 'function') {
      result.then(null, (err) => next(err || new Error('Rejected promise with no reason')));
    }
  } catch (err) {
    next(err);
  }
}

function decodeParam(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw createError(400, `Failed to decode param '${value}'`);
  }
}

Layer.invoke = invoke;
module.exports = Layer;
