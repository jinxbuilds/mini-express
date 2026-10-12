'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { request } = require('./helpers');
const express = require('..');

describe('middleware', () => {
  test('app.use() runs for every request in registration order', async () => {
    const app = express();
    const seen = [];
    app.use((req, res, next) => { seen.push('first'); next(); });
    app.use((req, res, next) => { seen.push('second'); next(); });
    app.get('/', (req, res) => res.send(seen.join(',')));
    assert.equal((await request(app, '/')).text, 'first,second');
  });

  test('mount paths strip the prefix and set baseUrl', async () => {
    const app = express();
    app.use('/api', (req, res) => {
      res.json({ url: req.url, baseUrl: req.baseUrl, originalUrl: req.originalUrl });
    });
    const res = await request(app, '/api/users?x=1');
    assert.deepEqual(res.body, { url: '/users?x=1', baseUrl: '/api', originalUrl: '/api/users?x=1' });
  });

  test('mount paths only match whole segments', async () => {
    const app = express();
    app.use('/api', (req, res) => res.send('api'));
    assert.equal((await request(app, '/apiary')).status, 404);
  });

  test('req.url is restored after mounted middleware calls next()', async () => {
    const app = express();
    app.use('/a', (req, res, next) => next());
    app.get('/a/b', (req, res) => res.send(req.url));
    assert.equal((await request(app, '/a/b')).text, '/a/b');
  });

  test('routers can be nested and mounted', async () => {
    const app = express();
    const api = express.Router();
    const users = express.Router();
    users.get('/:id', (req, res) => res.json({ id: req.params.id, baseUrl: req.baseUrl }));
    api.use('/users', users);
    app.use('/api/v1', api);
    const res = await request(app, '/api/v1/users/9');
    assert.deepEqual(res.body, { id: '9', baseUrl: '/api/v1/users' });
  });

  test('mergeParams exposes parent route params', async () => {
    const app = express();
    const comments = express.Router({ mergeParams: true });
    comments.get('/:commentId', (req, res) => res.json(req.params));
    app.use('/posts/:postId/comments', comments);
    const res = await request(app, '/posts/3/comments/8');
    assert.deepEqual(res.body, { postId: '3', commentId: '8' });
  });

  test("next('router') leaves the current router", async () => {
    const app = express();
    const router = express.Router();
    router.use((req, res, next) => next('router'));
    router.get('/', (req, res) => res.send('inside'));
    app.use(router);
    app.get('/', (req, res) => res.send('outside'));
    assert.equal((await request(app, '/')).text, 'outside');
  });

  test('sub-apps can be mounted and inherit settings', async () => {
    const app = express();
    const admin = express();
    app.set('title', 'Main');
    admin.get('/', (req, res) => res.json({
      title: admin.get('title'),
      mountpath: admin.mountpath,
      baseUrl: req.baseUrl,
      sameApp: req.app === admin,
    }));
    app.use('/admin', admin);
    app.get('/', (req, res) => res.send(String(req.app === app)));

    const res = await request(app, '/admin');
    assert.deepEqual(res.body, { title: 'Main', mountpath: '/admin', baseUrl: '/admin', sameApp: true });
    assert.equal((await request(app, '/')).text, 'true');
  });
});

describe('error handling', () => {
  test('thrown errors go to error middleware', async () => {
    const app = express();
    app.get('/', () => { throw new Error('boom'); });
    app.use((err, req, res, next) => res.status(500).json({ message: err.message }));
    const res = await request(app, '/');
    assert.equal(res.status, 500);
    assert.deepEqual(res.body, { message: 'boom' });
  });

  test('rejected promises from async handlers are caught', async () => {
    const app = express();
    app.get('/', async () => {
      await new Promise((r) => setTimeout(r, 5));
      throw Object.assign(new Error('teapot'), { status: 418 });
    });
    app.use((err, req, res, next) => res.status(err.status).send(err.message));
    const res = await request(app, '/');
    assert.equal(res.status, 418);
    assert.equal(res.text, 'teapot');
  });

  test('regular middleware is skipped while an error is pending', async () => {
    const app = express();
    const ran = [];
    app.use((req, res, next) => next(new Error('x')));
    app.use((req, res, next) => { ran.push('normal'); next(); });
    app.get('/', (req, res) => { ran.push('route'); res.send('no'); });
    app.use((err, req, res, next) => res.send(`handled:${ran.length}`));
    assert.equal((await request(app, '/')).text, 'handled:0');
  });

  test('error handlers can recover by calling next() without an error', async () => {
    const app = express();
    app.use((req, res, next) => next(new Error('x')));
    app.use((err, req, res, next) => next());
    app.get('/', (req, res) => res.send('recovered'));
    assert.equal((await request(app, '/')).text, 'recovered');
  });

  test('default handler uses err.status and hides stack in production', async (t) => {
    t.mock.method(console, 'error', () => {});
    const app = express();
    app.set('env', 'production');
    app.get('/', () => { throw new Error('secret internals'); });
    app.get('/client', () => { throw Object.assign(new Error('Bad input'), { status: 400, expose: true }); });

    const server = await request(app, '/');
    assert.equal(server.status, 500);
    assert.doesNotMatch(server.text, /secret internals/);
    assert.match(server.text, /Internal Server Error/);

    const client = await request(app, '/client');
    assert.equal(client.status, 400);
    assert.match(client.text, /Bad input/);
  });

  test('error page escapes HTML in the URL', async () => {
    const res = await request(express(), '/<script>');
    assert.doesNotMatch(res.text, /<script>/);
  });
});
