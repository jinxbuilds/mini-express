'use strict';

const Layer = require('./layer');
const Route = require('./route');
const { methods, flatten, getPathname } = require('../utils');

/**
 * Create a router. Routers are themselves middleware, so they can be
 * mounted with `app.use('/api', router)` or nested inside each other.
 *
 * @param {{ caseSensitive?: boolean, strict?: boolean, mergeParams?: boolean }} [options]
 */
function Router(options = {}) {
  function router(req, res, next) {
    router.handle(req, res, next);
  }

  Object.setPrototypeOf(router, proto);

  router.params = Object.create(null);
  router.caseSensitive = Boolean(options.caseSensitive);
  router.strict = Boolean(options.strict);
  router.mergeParams = Boolean(options.mergeParams);
  router.stack = [];

  return router;
}

const proto = Object.create(Function.prototype);
Router.prototype = proto;

/**
 * Register a callback that runs whenever a route parameter is present,
 * e.g. load a record for every route containing `:id`.
 */
proto.param = function param(name, fn) {
  if (typeof fn !== 'function') throw new TypeError('router.param() requires a callback function');
  (this.params[name] = this.params[name] || []).push(fn);
  return this;
};

/** Mount middleware at an optional path prefix. */
proto.use = function use(...args) {
  let path = '/';
  if (typeof args[0] === 'string' || args[0] instanceof RegExp) path = args.shift();

  const fns = flatten(args);
  if (fns.length === 0) throw new TypeError('router.use() requires a middleware function');

  for (const fn of fns) {
    if (typeof fn !== 'function') {
      throw new TypeError(`router.use() requires a middleware function but got a ${typeof fn}`);
    }
    const layer = new Layer(path, { sensitive: this.caseSensitive, strict: false, end: false }, fn);
    this.stack.push(layer);
  }
  return this;
};

/** Create a Route for `path` and add it to the stack. */
proto.route = function route(path) {
  const route = new Route(path);
  const layer = new Layer(
    path,
    { sensitive: this.caseSensitive, strict: this.strict, end: true },
    route.dispatch.bind(route),
  );
  layer.route = route;
  this.stack.push(layer);
  return route;
};

for (const method of [...methods, 'all']) {
  proto[method] = function (path, ...handlers) {
    this.route(path)[method](...handlers);
    return this;
  };
}

/**
 * The heart of the framework: walk the stack, find the next layer whose
 * path (and method, for routes) matches, and invoke it with a `next`
 * callback that resumes the walk.
 */
proto.handle = function handle(req, res, out) {
  const self = this;
  const stack = this.stack;
  let idx = 0;

  // State for mounted middleware: we strip the mount path from req.url
  // while the middleware runs, and restore it when it calls next().
  let removed = '';
  let slashAdded = false;
  const allowed = new Set();

  const parentUrl = req.baseUrl || '';
  const parentParams = req.params;
  const parentNext = req.next;
  const paramCalled = Object.create(null);

  const done = (err) => {
    req.baseUrl = parentUrl;
    req.params = parentParams;
    req.next = parentNext;
    out(err);
  };

  req.next = next;
  req.baseUrl = parentUrl;
  req.originalUrl = req.originalUrl || req.url;

  next();

  function next(err) {
    let layerError = err === 'route' ? null : err;

    if (slashAdded) {
      req.url = req.url.slice(1);
      slashAdded = false;
    }
    if (removed.length !== 0) {
      req.baseUrl = parentUrl;
      req.url = removed + req.url;
      removed = '';
    }

    // next('router') exits this router entirely.
    if (layerError === 'router') return setImmediate(done, null);
    if (idx >= stack.length) return setImmediate(finish, layerError);

    const pathname = getPathname(req.url);
    let layer;
    let match = false;
    let route;

    while (match !== true && idx < stack.length) {
      layer = stack[idx++];
      try {
        match = layer.match(pathname);
      } catch (decodeError) {
        layerError = layerError || decodeError;
        match = false;
        continue;
      }
      route = layer.route;

      if (!match) continue;
      if (!route) continue; // plain middleware: always eligible

      // Routes never handle errors; only middleware with arity 4 does.
      if (layerError) {
        match = false;
        continue;
      }

      if (!route.handlesMethod(req.method)) {
        route.allowedMethods().forEach((m) => allowed.add(m));
        match = false;
      }
    }

    if (match !== true) return finish(layerError);

    req.params = self.mergeParams
      ? { ...parentParams, ...layer.params }
      : layer.params;

    if (route) {
      return processParams(layer, req, res, (paramErr) => {
        if (paramErr) return next(paramErr);
        layer.handleRequest(req, res, next);
      });
    }

    trimPrefix(layer, layerError, pathname);
  }

  /** Strip the matched mount path so the middleware sees a relative URL. */
  function trimPrefix(layer, layerError, pathname) {
    const layerPath = layer.path;

    if (layerPath.length !== 0) {
      // Only strip on a segment boundary.
      const c = pathname[layerPath.length];
      if (c && c !== '/') return next(layerError);

      removed = layerPath;
      req.url = req.url.slice(removed.length);
      if (req.url[0] !== '/') {
        req.url = '/' + req.url;
        slashAdded = true;
      }
      req.baseUrl = parentUrl + (removed.endsWith('/') ? removed.slice(0, -1) : removed);
    }

    if (layerError) layer.handleError(layerError, req, res, next);
    else layer.handleRequest(req, res, next);
  }

  /** Reached the end of the stack. Auto-answer OPTIONS if any route matched the path. */
  function finish(err) {
    if (!err && req.method === 'OPTIONS' && allowed.size > 0) {
      res.setHeader('Allow', [...allowed].join(', '));
      res.statusCode = 204;
      return res.end();
    }
    done(err);
  }

  /** Run router.param() callbacks for each param in the matched route. */
  function processParams(layer, req, res, cb) {
    const keys = layer.keys;
    let i = 0;

    function nextParam(err) {
      if (err) return cb(err);
      if (i >= keys.length) return cb();

      const name = keys[i++].name;
      const value = req.params[name];
      const fns = self.params[name];
      if (value === undefined || !fns) return nextParam();

      // Each param callback runs at most once per value per request.
      if (paramCalled[name] && paramCalled[name].value === value) {
        return nextParam(paramCalled[name].error);
      }
      const state = (paramCalled[name] = { value, error: undefined });

      let j = 0;
      (function nextFn(fnErr) {
        if (fnErr) {
          state.error = fnErr;
          return nextParam(fnErr);
        }
        const fn = fns[j++];
        if (!fn) return nextParam();
        Layer.invoke(() => fn(req, res, nextFn, value, name), nextFn);
      })();
    }

    nextParam();
  }
};

module.exports = Router;
