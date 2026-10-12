'use strict';

const path = require('path');
const express = require('../..');
const { NotesStore, seed } = require('./store');
const notesRouter = require('./routes/notes');
const observability = require('./middleware/observability');
const rateLimit = require('./middleware/rate-limit');
const { notFound, errorHandler } = require('./middleware/errors');

const pkg = require('../../package.json');

/**
 * Build the demo app. Exported as a factory so tests can create isolated
 * instances with a fresh store.
 */
function createApp({ store = new NotesStore(seed), log = true, rateLimitMax = 300 } = {}) {
  const app = express();
  const startedAt = Date.now();

  // ---- global middleware -------------------------------------------------
  app.use(observability({ log }));
  app.use(express.static(path.join(__dirname, 'public'), { maxAge: 60_000 }));

  // ---- API ---------------------------------------------------------------
  const api = express.Router();
  api.use(rateLimit({ windowMs: 60_000, max: rateLimitMax }));
  api.use(express.json({ limit: '16kb' }));

  api.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      framework: `${pkg.name}@${pkg.version}`,
      node: process.version,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    });
  });

  // Reflects the parsed request back — handy for seeing what the framework does.
  api.all('/echo/*', (req, res) => {
    res.json({
      method: req.method,
      originalUrl: req.originalUrl,
      baseUrl: req.baseUrl,
      path: req.path,
      params: req.params,
      query: req.query,
      body: req.body,
      ip: req.ip,
      accepts: req.accepts('json', 'html'),
      headers: req.headers,
    });
  });

  // Demonstrates async errors flowing into the error handler.
  api.get('/boom', async () => {
    await new Promise((r) => setTimeout(r, 10));
    throw Object.assign(new Error('Something exploded (on purpose)'), { status: 500 });
  });

  api.use('/notes', notesRouter(store));
  api.use(notFound);
  api.use(errorHandler);

  app.use('/api', api);

  // Old URL kept alive with a permanent redirect.
  app.get('/notes', (req, res) => res.redirect(301, '/#notes'));

  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => {
    console.log(`\n  mini-express demo running at \x1b[36mhttp://localhost:${port}\x1b[0m\n`);
  });
}

module.exports = createApp;
