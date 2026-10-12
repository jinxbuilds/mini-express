'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { request } = require('./helpers');
const express = require('..');

describe('express.json()', () => {
  const app = express();
  app.use(express.json({ limit: '1kb' }));
  app.post('/', (req, res) => res.json({ body: req.body }));

  test('parses JSON bodies', async () => {
    const res = await request(app, '/', { method: 'POST', body: { name: 'mini', n: 1 } });
    assert.deepEqual(res.body, { body: { name: 'mini', n: 1 } });
  });

  test('accepts +json content types', async () => {
    const res = await request(app, '/', {
      method: 'POST', body: '{"a":1}', headers: { 'content-type': 'application/vnd.api+json' },
    });
    assert.deepEqual(res.body.body, { a: 1 });
  });

  test('ignores other content types', async () => {
    const res = await request(app, '/', { method: 'POST', body: 'a=1', headers: { 'content-type': 'text/plain' } });
    assert.deepEqual(res.body, { body: {} });
  });

  test('invalid JSON -> 400', async () => {
    const res = await request(app, '/', { method: 'POST', body: '{nope', headers: { 'content-type': 'application/json' } });
    assert.equal(res.status, 400);
  });

  test('strict mode rejects primitives', async () => {
    const res = await request(app, '/', { method: 'POST', body: '"str"', headers: { 'content-type': 'application/json' } });
    assert.equal(res.status, 400);
  });

  test('bodies over the limit -> 413', async () => {
    const res = await request(app, '/', { method: 'POST', body: { big: 'x'.repeat(2000) } });
    assert.equal(res.status, 413);
  });
});

describe('express.urlencoded()', () => {
  test('parses form bodies', async () => {
    const app = express();
    app.use(express.urlencoded());
    app.post('/', (req, res) => res.json(req.body));
    const res = await request(app, '/', {
      method: 'POST',
      body: 'name=Ada+Lovelace&lang=js&lang=go',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    assert.deepEqual(res.body, { name: 'Ada Lovelace', lang: ['js', 'go'] });
  });
});

describe('express.static()', () => {
  let root;
  let app;

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-express-'));
    fs.writeFileSync(path.join(root, 'hello.txt'), 'hello world');
    fs.writeFileSync(path.join(root, 'style.css'), 'body{}');
    fs.writeFileSync(path.join(root, '.env'), 'SECRET=1');
    fs.mkdirSync(path.join(root, 'docs'));
    fs.writeFileSync(path.join(root, 'docs', 'index.html'), '<h1>docs</h1>');

    app = express();
    app.use('/static', express.static(root, { maxAge: 60_000 }));
    app.use(express.static(root));
    app.get('/fallthrough', (req, res) => res.send('route'));
  });

  after(() => fs.rmSync(root, { recursive: true, force: true }));

  test('serves files with the right content type and caching headers', async () => {
    const res = await request(app, '/static/style.css');
    assert.equal(res.status, 200);
    assert.equal(res.text, 'body{}');
    assert.equal(res.headers.get('content-type'), 'text/css; charset=utf-8');
    assert.equal(res.headers.get('cache-control'), 'public, max-age=60');
    assert.ok(res.headers.get('etag'));
    assert.ok(res.headers.get('last-modified'));
  });

  test('answers 304 for a matching ETag', async () => {
    const first = await request(app, '/hello.txt');
    const res = await request(app, '/hello.txt', { headers: { 'if-none-match': first.headers.get('etag') } });
    assert.equal(res.status, 304);
  });

  test('serves index.html and redirects directories to a trailing slash', async () => {
    const redirect = await request(app, '/docs');
    assert.equal(redirect.status, 301);
    assert.equal(redirect.headers.get('location'), '/docs/');
    const res = await request(app, '/docs/');
    assert.equal(res.text, '<h1>docs</h1>');
  });

  test('falls through to later routes when no file exists', async () => {
    assert.equal((await request(app, '/fallthrough')).text, 'route');
  });

  test('blocks path traversal and dotfiles', async () => {
    assert.equal((await request(app, '/static/..%2f..%2f..%2fetc%2fpasswd')).status, 404);
    assert.equal((await request(app, '/static/%2e%2e/%2e%2e/package.json')).status, 404);
    assert.equal((await request(app, '/.env')).status, 404);
  });

  test('ignores non-GET methods', async () => {
    assert.equal((await request(app, '/hello.txt', { method: 'POST' })).status, 404);
  });
});

describe('res.sendFile() / res.download()', () => {
  test('sends a file relative to root, rejecting escapes', async () => {
    const app = express();
    const root = path.join(__dirname, '..');
    app.get('/pkg', (req, res) => res.sendFile('package.json', { root }));
    app.get('/escape', (req, res) => res.sendFile('../../etc/passwd', { root }));
    app.get('/dl', (req, res) => res.download(path.join(root, 'package.json'), 'meta.json'));

    const pkg = await request(app, '/pkg');
    assert.equal(pkg.body.name, 'mini-express');
    assert.equal((await request(app, '/escape')).status, 403);

    const dl = await request(app, '/dl');
    assert.equal(dl.headers.get('content-disposition'), 'attachment; filename="meta.json"');
  });

  test('missing files go to the error handler as 404', async () => {
    const app = express();
    app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'nope.txt')));
    assert.equal((await request(app, '/')).status, 404);
  });
});
