'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { request } = require('./helpers');
const express = require('..');

describe('routing', () => {
  test('matches method and path', async () => {
    const app = express();
    app.get('/', (req, res) => res.send('get root'));
    app.post('/', (req, res) => res.send('post root'));
    app.get('/about', (req, res) => res.send('about'));

    assert.equal((await request(app, '/')).text, 'get root');
    assert.equal((await request(app, '/', { method: 'POST' })).text, 'post root');
    assert.equal((await request(app, '/about')).text, 'about');
  });

  test('responds 404 when nothing matches', async () => {
    const app = express();
    app.get('/', (req, res) => res.send('hi'));
    const res = await request(app, '/missing');
    assert.equal(res.status, 404);
    assert.match(res.text, /Cannot GET \/missing/);
  });

  test('app with no routes responds 404', async () => {
    const res = await request(express(), '/');
    assert.equal(res.status, 404);
  });

  test('route params are decoded', async () => {
    const app = express();
    app.get('/users/:id/books/:book', (req, res) => res.json(req.params));
    const res = await request(app, '/users/7/books/a%20tale');
    assert.deepEqual(res.body, { id: '7', book: 'a tale' });
  });

  test('malformed param encoding yields 400', async () => {
    const app = express();
    app.get('/users/:id', (req, res) => res.send('nope'));
    const res = await request(app, '/users/%E0%A4%A');
    assert.equal(res.status, 400);
  });

  test('query strings are parsed, repeated keys become arrays', async () => {
    const app = express();
    app.get('/search', (req, res) => res.json(req.query));
    const res = await request(app, '/search?q=node&tag=a&tag=b');
    assert.deepEqual(res.body, { q: 'node', tag: ['a', 'b'] });
  });

  test('multiple handlers run in order via next()', async () => {
    const app = express();
    app.get(
      '/',
      (req, res, next) => { req.trail = ['a']; next(); },
      [(req, res, next) => { req.trail.push('b'); next(); }],
      (req, res) => res.json(req.trail),
    );
    assert.deepEqual((await request(app, '/')).body, ['a', 'b']);
  });

  test("next('route') skips to the next matching route", async () => {
    const app = express();
    app.get('/x', (req, res, next) => next('route'), (req, res) => res.send('skipped'));
    app.get('/x', (req, res) => res.send('second route'));
    assert.equal((await request(app, '/x')).text, 'second route');
  });

  test('app.route() chains handlers for one path', async () => {
    const app = express();
    app.route('/book')
      .get((req, res) => res.send('read'))
      .put((req, res) => res.send('update'));
    assert.equal((await request(app, '/book')).text, 'read');
    assert.equal((await request(app, '/book', { method: 'PUT' })).text, 'update');
  });

  test('app.all() matches every method', async () => {
    const app = express();
    app.all('/any', (req, res) => res.send(req.method));
    assert.equal((await request(app, '/any', { method: 'DELETE' })).text, 'DELETE');
    assert.equal((await request(app, '/any', { method: 'PATCH' })).text, 'PATCH');
  });

  test('HEAD falls back to GET without a body', async () => {
    const app = express();
    app.get('/', (req, res) => res.send('hello'));
    const res = await request(app, '/', { method: 'HEAD' });
    assert.equal(res.status, 200);
    assert.equal(res.text, '');
    assert.equal(res.headers.get('content-length'), '5');
  });

  test('OPTIONS is answered automatically with Allow', async () => {
    const app = express();
    app.get('/thing', (req, res) => res.send('x'));
    app.post('/thing', (req, res) => res.send('x'));
    const res = await request(app, '/thing', { method: 'OPTIONS' });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('allow'), 'GET, HEAD, POST');
  });

  test('unmatched method on a known path falls through to later routes', async () => {
    const app = express();
    const router = express.Router();
    router.get('/x', (req, res) => res.send('router get'));
    app.use(router);
    app.put('/x', (req, res) => res.send('app put'));
    assert.equal((await request(app, '/x', { method: 'PUT' })).text, 'app put');
  });

  test('case-insensitive by default, configurable', async () => {
    const app = express();
    app.get('/About', (req, res) => res.send('ok'));
    assert.equal((await request(app, '/about')).status, 200);

    const strictApp = express();
    strictApp.enable('case sensitive routing');
    strictApp.get('/About', (req, res) => res.send('ok'));
    assert.equal((await request(strictApp, '/about')).status, 404);
  });

  test('rejects non-function handlers', () => {
    const app = express();
    assert.throws(() => app.get('/', 'nope'), /requires a callback function/);
  });
});

describe('app.param / router.param', () => {
  test('runs once per request and can load data', async () => {
    const app = express();
    let calls = 0;
    app.param('id', (req, res, next, id) => {
      calls++;
      req.user = { id: Number(id) };
      next();
    });
    app.get('/users/:id', (req, res, next) => next());
    app.get('/users/:id', (req, res) => res.json(req.user));

    const res = await request(app, '/users/5');
    assert.deepEqual(res.body, { id: 5 });
    assert.equal(calls, 1);
  });

  test('async param errors reach error handlers', async () => {
    const app = express();
    app.param('id', async () => { throw Object.assign(new Error('nope'), { status: 404 }); });
    app.get('/users/:id', (req, res) => res.send('unreachable'));
    assert.equal((await request(app, '/users/1')).status, 404);
  });
});
