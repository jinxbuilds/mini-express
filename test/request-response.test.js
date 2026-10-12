'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { request } = require('./helpers');
const express = require('..');

describe('req helpers', () => {
  test('req.get() is case-insensitive and aliases referrer', async () => {
    const app = express();
    app.get('/', (req, res) => res.json({ ua: req.get('X-Custom'), ref: req.get('Referrer') }));
    const res = await request(app, '/', { headers: { 'x-custom': 'yes', referer: 'http://a.test' } });
    assert.deepEqual(res.body, { ua: 'yes', ref: 'http://a.test' });
  });

  test('req.path, req.hostname, req.protocol', async () => {
    const app = express();
    app.get('/p', (req, res) => res.json({ path: req.path, host: req.hostname, protocol: req.protocol }));
    const res = await request(app, '/p?x=1');
    assert.deepEqual(res.body, { path: '/p', host: '127.0.0.1', protocol: 'http' });
  });

  test('trust proxy reads X-Forwarded-* headers', async () => {
    const app = express();
    app.enable('trust proxy');
    app.get('/', (req, res) => res.json({ ip: req.ip, protocol: req.protocol, secure: req.secure }));
    const res = await request(app, '/', {
      headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1', 'x-forwarded-proto': 'https' },
    });
    assert.deepEqual(res.body, { ip: '203.0.113.9', protocol: 'https', secure: true });
  });

  test('req.accepts() honours q-values', async () => {
    const app = express();
    app.get('/', (req, res) => res.send(String(req.accepts('html', 'json'))));
    const res = await request(app, '/', { headers: { accept: 'text/html;q=0.5, application/json' } });
    assert.equal(res.text, 'json');
  });

  test('req.is() checks the body content type', async () => {
    const app = express();
    app.post('/', (req, res) => res.json([req.is('json'), req.is('application/*'), req.is('html')]));
    const res = await request(app, '/', { method: 'POST', body: { a: 1 } });
    assert.deepEqual(res.body, ['json', 'application/*', false]);
  });
});

describe('res helpers', () => {
  test('res.status().json() chains and sets content type', async () => {
    const app = express();
    app.get('/', (req, res) => res.status(201).json({ ok: true }));
    const res = await request(app, '/');
    assert.equal(res.status, 201);
    assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.deepEqual(res.body, { ok: true });
  });

  test('res.send() picks a content type from the body', async () => {
    const app = express();
    app.get('/html', (req, res) => res.send('<b>hi</b>'));
    app.get('/buf', (req, res) => res.send(Buffer.from('raw')));
    app.get('/obj', (req, res) => res.send({ a: 1 }));
    app.get('/typed', (req, res) => res.type('txt').send('plain'));

    assert.match((await request(app, '/html')).headers.get('content-type'), /^text\/html/);
    assert.equal((await request(app, '/buf')).headers.get('content-type'), 'application/octet-stream');
    assert.match((await request(app, '/obj')).headers.get('content-type'), /^application\/json/);
    assert.match((await request(app, '/typed')).headers.get('content-type'), /^text\/plain/);
  });

  test('res.send() adds an ETag and answers 304 when fresh', async () => {
    const app = express();
    app.get('/', (req, res) => res.send('cache me'));
    const first = await request(app, '/');
    const etag = first.headers.get('etag');
    assert.match(etag, /^W\/"/);
    const second = await request(app, '/', { headers: { 'if-none-match': etag } });
    assert.equal(second.status, 304);
    assert.equal(second.text, '');
  });

  test('res.sendStatus()', async () => {
    const app = express();
    app.get('/', (req, res) => res.sendStatus(403));
    const res = await request(app, '/');
    assert.equal(res.status, 403);
    assert.equal(res.text, 'Forbidden');
  });

  test('res.redirect() defaults to 302 and accepts a status', async () => {
    const app = express();
    app.get('/old', (req, res) => res.redirect('/new'));
    app.get('/moved', (req, res) => res.redirect(301, '/permanent'));
    const a = await request(app, '/old');
    assert.equal(a.status, 302);
    assert.equal(a.headers.get('location'), '/new');
    const b = await request(app, '/moved');
    assert.equal(b.status, 301);
    assert.equal(b.headers.get('location'), '/permanent');
  });

  test('res.set() with an object, res.get()', async () => {
    const app = express();
    app.get('/', (req, res) => {
      res.set({ 'X-One': '1', 'X-Two': 2 });
      res.send(res.get('X-One'));
    });
    const res = await request(app, '/');
    assert.equal(res.headers.get('x-two'), '2');
    assert.equal(res.text, '1');
  });

  test('res.cookie() and res.clearCookie()', async () => {
    const app = express();
    app.get('/', (req, res) => {
      res.cookie('session', 'abc', { httpOnly: true, sameSite: 'lax', maxAge: 60_000 });
      res.cookie('prefs', { theme: 'dark' });
      res.clearCookie('old');
      res.end();
    });
    const res = await request(app, '/');
    const cookies = res.headers.getSetCookie();
    assert.equal(cookies.length, 3);
    assert.match(cookies[0], /^session=abc; Max-Age=60; Path=\/; Expires=.+; HttpOnly; SameSite=Lax$/);
    assert.match(cookies[1], /^prefs=j%3A%7B%22theme%22%3A%22dark%22%7D/);
    assert.match(cookies[2], /^old=; Path=\/; Expires=Thu, 01 Jan 1970/);
  });

  test('res.locals is available per request', async () => {
    const app = express();
    app.use((req, res, next) => { res.locals.user = 'ada'; next(); });
    app.get('/', (req, res) => res.send(res.locals.user));
    assert.equal((await request(app, '/')).text, 'ada');
  });

  test('X-Powered-By can be disabled', async () => {
    const app = express();
    app.get('/', (req, res) => res.send('x'));
    assert.equal((await request(app, '/')).headers.get('x-powered-by'), 'mini-express');
    app.disable('x-powered-by');
    assert.equal((await request(app, '/')).headers.get('x-powered-by'), null);
  });

  test('json spaces setting formats output', async () => {
    const app = express();
    app.set('json spaces', 0);
    app.get('/', (req, res) => res.json({ a: [1, 2] }));
    assert.equal((await request(app, '/')).text, '{"a":[1,2]}');
  });
});

describe('settings', () => {
  test('set/get/enable/disable', () => {
    const app = express();
    app.set('foo', 'bar');
    assert.equal(app.get('foo'), 'bar');
    app.enable('flag');
    assert.equal(app.enabled('flag'), true);
    app.disable('flag');
    assert.equal(app.disabled('flag'), true);
  });
});
