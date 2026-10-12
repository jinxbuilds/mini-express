'use strict';

const http = require('http');

/** Lower-cased HTTP verbs Node knows about: get, post, put, delete, patch, ... */
const methods = http.METHODS.map((m) => m.toLowerCase());

/** Flatten nested arrays of handlers: use(a, [b, [c]]) -> [a, b, c]. */
function flatten(arr) {
  return arr.flat(Infinity);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

/** Create an Error carrying an HTTP status, like the `http-errors` package. */
function createError(status, message, props = {}) {
  const err = new Error(message || http.STATUS_CODES[status] || 'Error');
  err.status = err.statusCode = status;
  err.expose = status < 500;
  return Object.assign(err, props);
}

/** Pathname portion of a request URL ("/a/b?x=1" -> "/a/b"). */
function getPathname(url = '/') {
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

/** Parse a query string into an object; repeated keys become arrays. */
function parseQuery(qs) {
  const out = Object.create(null);
  for (const [key, value] of new URLSearchParams(qs)) {
    if (key in out) out[key] = [].concat(out[key], value);
    else out[key] = value;
  }
  return out;
}

/** Bare MIME type from a Content-Type header ("text/html; charset=utf-8" -> "text/html"). */
function mimeOf(header) {
  return header ? header.split(';')[0].trim().toLowerCase() : '';
}

module.exports = { methods, flatten, escapeHtml, createError, getPathname, parseQuery, mimeOf };
