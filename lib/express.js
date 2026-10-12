'use strict';

const appProto = require('./application');
const Router = require('./router');
const Route = require('./router/route');
const reqProto = require('./request');
const resProto = require('./response');
const json = require('./middleware/json');
const urlencoded = require('./middleware/urlencoded');
const serveStatic = require('./middleware/static');

/**
 * Create an application. The app is a plain function `(req, res) => void`
 * so it can be passed straight to http.createServer().
 */
function createApplication() {
  const app = function (req, res, next) {
    app.handle(req, res, next);
  };

  Object.assign(app, appProto);

  // Per-app request/response prototypes, so `req.app` points back here.
  app.request = Object.create(reqProto, {
    app: { configurable: true, enumerable: true, writable: true, value: app },
  });
  app.response = Object.create(resProto, {
    app: { configurable: true, enumerable: true, writable: true, value: app },
  });

  app.init();
  return app;
}

module.exports = createApplication;
module.exports.application = appProto;
module.exports.request = reqProto;
module.exports.response = resProto;
module.exports.Router = Router;
module.exports.Route = Route;
module.exports.json = json;
module.exports.urlencoded = urlencoded;
module.exports.static = serveStatic;
