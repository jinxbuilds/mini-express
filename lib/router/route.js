'use strict';

const Layer = require('./layer');
const { methods, flatten } = require('../utils');

/**
 * A Route is a single path with a stack of method-specific handlers:
 *
 *   app.route('/notes').get(list).post(validate, create)
 */
class Route {
  constructor(path) {
    this.path = path;
    this.stack = [];
    this.methods = Object.create(null);
  }

  /** Does this route have a handler for the given HTTP method? */
  handlesMethod(method) {
    if (this.methods._all) return true;
    let name = method.toLowerCase();
    // HEAD falls back to GET (the body is dropped by res.send).
    if (name === 'head' && !this.methods.head) name = 'get';
    return Boolean(this.methods[name]);
  }

  /** Methods this route responds to, for the `Allow` header. */
  allowedMethods() {
    const list = Object.keys(this.methods).filter((m) => m !== '_all');
    if (this.methods.get && !this.methods.head) list.push('head');
    return list.map((m) => m.toUpperCase());
  }

  /** Run the handlers matching `req.method`, in order. */
  dispatch(req, res, done) {
    const stack = this.stack;
    let idx = 0;
    let method = req.method.toLowerCase();
    if (method === 'head' && !this.methods.head) method = 'get';

    req.route = this;
    next();

    function next(err) {
      // next('route') skips the remaining handlers of this route.
      if (err === 'route') return done();
      if (err === 'router') return done(err);

      const layer = stack[idx++];
      if (!layer) return done(err);
      if (layer.method && layer.method !== method) return next(err);

      if (err) layer.handleError(err, req, res, next);
      else layer.handleRequest(req, res, next);
    }
  }

  all(...handlers) {
    for (const fn of flatten(handlers)) {
      assertFunction(fn, 'all');
      this.methods._all = true;
      this.stack.push(new Layer('/', {}, fn));
    }
    return this;
  }
}

for (const method of methods) {
  Route.prototype[method] = function (...handlers) {
    for (const fn of flatten(handlers)) {
      assertFunction(fn, method);
      const layer = new Layer('/', {}, fn);
      layer.method = method;
      this.methods[method] = true;
      this.stack.push(layer);
    }
    return this;
  };
}

function assertFunction(fn, method) {
  if (typeof fn !== 'function') {
    const type = Object.prototype.toString.call(fn);
    throw new TypeError(`Route.${method}() requires a callback function but got a ${type}`);
  }
}

module.exports = Route;
