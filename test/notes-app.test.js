'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { request } = require('./helpers');
const createApp = require('../examples/notes-app/server');
const { NotesStore, seed } = require('../examples/notes-app/store');

const makeApp = (opts = {}) => createApp({ store: new NotesStore(seed), log: false, ...opts });

describe('notes demo app', () => {
  test('serves the dashboard', async () => {
    const res = await request(makeApp(), '/');
    assert.equal(res.status, 200);
    assert.match(res.text, /mini-express/);
    assert.ok(res.headers.get('x-request-id'));
    assert.match(res.headers.get('x-response-time'), /ms$/);
  });

  test('GET /api/health', async () => {
    const res = await request(makeApp(), '/api/health');
    assert.equal(res.body.status, 'ok');
    assert.match(res.body.framework, /^mini-express@/);
  });

  test('lists and filters notes', async () => {
    const app = makeApp();
    const all = await request(app, '/api/notes');
    assert.equal(all.body.count, seed.length);
    assert.equal(all.body.notes[0].pinned, true, 'pinned notes come first');

    const byTag = await request(app, '/api/notes?tag=router');
    assert.equal(byTag.body.count, 1);

    const bySearch = await request(app, '/api/notes?q=CONSOLE');
    assert.equal(bySearch.body.count, 1);
  });

  test('full CRUD lifecycle', async () => {
    const app = makeApp();

    const created = await request(app, '/api/notes', {
      method: 'POST', body: { title: '  New note ', tags: ['A', 'a', ' b '] },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.title, 'New note');
    assert.deepEqual(created.body.tags, ['a', 'b']);
    const { id } = created.body;
    assert.equal(created.headers.get('location'), `/api/notes/${id}`);

    const fetched = await request(app, `/api/notes/${id}`);
    assert.equal(fetched.body.id, id);

    const patched = await request(app, `/api/notes/${id}`, { method: 'PATCH', body: { pinned: true } });
    assert.equal(patched.body.pinned, true);
    assert.equal(patched.body.title, 'New note');

    const deleted = await request(app, `/api/notes/${id}`, { method: 'DELETE' });
    assert.equal(deleted.status, 204);

    const gone = await request(app, `/api/notes/${id}`);
    assert.equal(gone.status, 404);
    assert.match(gone.body.error.message, /not found/);
  });

  test('validation errors -> 422 with details', async () => {
    const res = await request(makeApp(), '/api/notes', {
      method: 'POST', body: { title: '', tags: 'nope', pinned: 'yes' },
    });
    assert.equal(res.status, 422);
    assert.deepEqual(res.body.error.details, [
      'title is required', 'tags must be an array of strings', 'pinned must be a boolean',
    ]);
  });

  test('malformed JSON -> 400', async () => {
    const res = await request(makeApp(), '/api/notes', {
      method: 'POST', body: '{bad', headers: { 'content-type': 'application/json' },
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /Invalid JSON/);
  });

  test('async errors are caught and reported as JSON', async () => {
    const res = await request(makeApp(), '/api/boom');
    assert.equal(res.status, 500);
    assert.equal(res.body.error.message, 'Something exploded (on purpose)');
  });

  test('unknown API routes -> JSON 404', async () => {
    const res = await request(makeApp(), '/api/nope');
    assert.equal(res.status, 404);
    assert.equal(res.body.error.message, 'No route for GET /api/nope');
  });

  test('echo endpoint reflects routing details', async () => {
    const res = await request(makeApp(), '/api/echo/x/y?a=1');
    assert.equal(res.body.baseUrl, '/api');
    assert.equal(res.body.path, '/echo/x/y');
    assert.deepEqual(res.body.params, { 0: 'x/y' });
    assert.deepEqual(res.body.query, { a: '1' });
  });

  test('rate limiting -> 429 after the budget is spent', async () => {
    const app = makeApp({ rateLimitMax: 2 });
    assert.equal((await request(app, '/api/health')).headers.get('ratelimit-remaining'), '1');
    await request(app, '/api/health');
    const limited = await request(app, '/api/health');
    assert.equal(limited.status, 429);
    assert.ok(limited.headers.get('retry-after'));
  });
});
