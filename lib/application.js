'use strict';

const http = require('http');
const Router = require('./router');
const finalhandler = require('./finalhandler');
const { methods, flatten } = require('./utils');

/** Prototype mixed into every app created by createApplication(). */
const app = {};

app.init = function init() {
  this.settings = {};
  this.locals = Object.create(null);
  this.mountpath = '/';
  this._router = undefined;

  const env = process.env.NODE_ENV || 'development';
  this.set('env', env);
  this.enable('x-powered-by');
  this.enable('etag');
  this.set('json spaces', env === 'production' ? undefined : 2);
};

/** The router is created on first use, so an app with no routes stays cheap. */
app.lazyrouter = function lazyrouter() {
  if (!this._router) {
    this._router = new Router({
      caseSensitive: this.enabled('case sensitive routing'),
      strict: this.enabled('strict routing'),
    });
  }
  return this._router;
};

/**
 * Entry point for every request: decorate req/res with our prototypes,
 * then hand off to the router. `callback` is used when this app is
 * mounted inside another one.
 */
app.handle = function handle(req, res, callback) {
  const done = callback || finalhandler(req, res, {
    env: this.get('env'),
    onerror: logerror.bind(this),
  });

  if (this.enabled('x-powered-by')) res.setHeader('X-Powered-By', 'mini-express');
  req.res = res;
  res.req = req;
  Object.setPrototypeOf(req, this.request);
  Object.setPrototypeOf(res, this.response);
  res.locals = res.locals || Object.create(null);

  if (!this._router) return done();
  this._router.handle(req, res, done);
};

/**
 * Mount middleware, routers or whole sub-apps at an optional path.
 *
 *   app.use(logger)
 *   app.use('/api', apiRouter)
 *   app.use('/admin', adminApp)
 */
app.use = function use(...args) {
  let path = '/';
  if (typeof args[0] === 'string' || args[0] instanceof RegExp) path = args.shift();

  const fns = flatten(args);
  if (fns.length === 0) throw new TypeError('app.use() requires a middleware function');

  const router = this.lazyrouter();
  for (const fn of fns) {
    // Plain middleware or routers go straight into the stack.
    if (!fn || !fn.handle || !fn.set) {
      router.use(path, fn);
      continue;
    }

    // A sub-app: let it handle the request with its own settings/prototypes,
    // then restore ours when it hands control back.
    const parent = this;
    fn.mountpath = path;
    fn.parent = parent;
    router.use(path, function mounted_app(req, res, next) {
      fn.handle(req, res, (err) => {
        Object.setPrototypeOf(req, parent.request);
        Object.setPrototypeOf(res, parent.response);
        next(err);
      });
    });
  }
  return this;
};

app.route = function route(path) {
  return this.lazyrouter().route(path);
};

app.param = function param(name, fn) {
  for (const n of [].concat(name)) this.lazyrouter().param(n, fn);
  return this;
};

for (const method of methods) {
  app[method] = function (path, ...handlers) {
    // app.get('setting') reads a setting; app.get('/path', fn) adds a route.
    if (method === 'get' && handlers.length === 0) return this.set(path);
    this.route(path)[method](...handlers);
    return this;
  };
}

app.all = function all(path, ...handlers) {
  this.route(path).all(...handlers);
  return this;
};

/** Settings: app.set(name, value) writes, app.set(name) reads (inheriting from a parent app). */
app.set = function set(name, value) {
  if (arguments.length === 1) {
    if (name in this.settings) return this.settings[name];
    return this.parent ? this.parent.set(name) : undefined;
  }
  this.settings[name] = value;
  return this;
};

app.enable = function enable(name) { return this.set(name, true); };
app.disable = function disable(name) { return this.set(name, false); };
app.enabled = function enabled(name) { return Boolean(this.set(name)); };
app.disabled = function disabled(name) { return !this.set(name); };

/** The full mount path of this app, including parents. */
app.path = function path() {
  return this.parent ? this.parent.path() + this.mountpath : '';
};

/** Start an HTTP server: app.listen(3000, () => ...). Returns the http.Server. */
app.listen = function listen(...args) {
  const server = http.createServer(this);
  return server.listen(...args);
};

function logerror(err) {
  const status = err.status || err.statusCode || 500;
  if (this.get('env') !== 'test' && status >= 500) console.error(err.stack || String(err));
}

module.exports = app;
