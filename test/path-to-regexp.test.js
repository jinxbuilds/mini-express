'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const pathToRegexp = require('../lib/utils/path-to-regexp');

const match = (path, url, opts) => {
  const { regexp, keys } = pathToRegexp(path, opts);
  const m = regexp.exec(url);
  if (!m) return null;
  return Object.fromEntries(keys.map((k, i) => [k.name, m[i + 1]]).filter(([, v]) => v !== undefined));
};

test('static paths match exactly', () => {
  assert.deepEqual(match('/users', '/users'), {});
  assert.equal(match('/users', '/users/1'), null);
  assert.equal(match('/users', '/user'), null);
});

test('trailing slash is optional unless strict', () => {
  assert.deepEqual(match('/users', '/users/'), {});
  assert.equal(match('/users', '/users/', { strict: true }), null);
});

test('named params', () => {
  assert.deepEqual(match('/users/:id', '/users/42'), { id: '42' });
  assert.deepEqual(match('/a/:x/b/:y', '/a/1/b/2'), { x: '1', y: '2' });
  assert.equal(match('/users/:id', '/users'), null);
});

test('optional params', () => {
  assert.deepEqual(match('/posts/:page?', '/posts'), {});
  assert.deepEqual(match('/posts/:page?', '/posts/3'), { page: '3' });
});

test('params after literal text', () => {
  assert.deepEqual(match('/file.:ext', '/file.json'), { ext: 'json' });
  assert.deepEqual(match('/flights/:from-:to', '/flights/LAX-SFO'), { from: 'LAX', to: 'SFO' });
});

test('wildcards', () => {
  assert.deepEqual(match('/files/*', '/files/a/b/c.txt'), { 0: 'a/b/c.txt' });
});

test('case sensitivity', () => {
  assert.deepEqual(match('/About', '/about'), {});
  assert.equal(match('/About', '/about', { sensitive: true }), null);
});

test('prefix matching (end: false) respects segment boundaries', () => {
  const opts = { end: false };
  assert.ok(match('/api', '/api', opts));
  assert.ok(match('/api', '/api/users', opts));
  assert.equal(match('/api', '/apiary', opts), null);
});

test('regex special characters are escaped', () => {
  assert.ok(match('/a.b', '/a.b'));
  assert.equal(match('/a.b', '/axb'), null);
});

test('RegExp paths are used as-is', () => {
  assert.deepEqual(match(/^\/v(\d+)\/ping$/, '/v2/ping'), { 0: '2' });
});
