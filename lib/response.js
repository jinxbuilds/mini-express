'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const mime = require('./utils/mime');
const sendFile = require('./utils/send-file');
const { escapeHtml, createError } = require('./utils');

/**
 * Prototype for `res`, inheriting from http.ServerResponse. All setters
 * return `this` so calls chain: res.status(201).set('X-Id', id).json(note).
 */
const res = Object.create(http.ServerResponse.prototype);

res.status = function status(code) {
  if (!Number.isInteger(code) || code < 100 || code > 999) {
    throw new RangeError(`Invalid status code: ${code}`);
  }
  this.statusCode = code;
  return this;
};

/** Set one header, or several with an object. Content-Type gets a charset. */
res.set = res.header = function header(field, value) {
  if (typeof field === 'object') {
    for (const [k, v] of Object.entries(field)) this.set(k, v);
    return this;
  }
  let val = Array.isArray(value) ? value.map(String) : String(value);
  if (field.toLowerCase() === 'content-type') val = mime.contentType(val);
  this.setHeader(field, val);
  return this;
};

res.get = function get(field) {
  return this.getHeader(field);
};

/** Append a value to a header, creating it if needed (e.g. multiple Set-Cookie). */
res.append = function append(field, value) {
  const prev = this.getHeader(field);
  const next = prev === undefined ? value : [].concat(prev, value);
  this.setHeader(field, Array.isArray(next) ? next.map(String) : String(next));
  return this;
};

/** Set Content-Type from an extension ("json") or full MIME type. */
res.type = res.contentType = function contentType(type) {
  return this.set('Content-Type', type.includes('/') ? type : mime.lookup(type) || 'application/octet-stream');
};

/**
 * Send a response. Strings default to HTML, Buffers to octet-stream and
 * objects to JSON. Adds Content-Length and a weak ETag, and answers 304
 * when the client's cached copy is still fresh.
 */
res.send = function send(body) {
  let chunk = body;
  const req = this.req;

  if (chunk === null || chunk === undefined) {
    chunk = '';
  } else if (typeof chunk === 'object' && !Buffer.isBuffer(chunk)) {
    return this.json(chunk);
  } else if (typeof chunk === 'number' || typeof chunk === 'boolean') {
    return this.json(chunk);
  }

  if (typeof chunk === 'string') {
    if (!this.get('Content-Type')) this.type('html');
  } else if (!this.get('Content-Type')) {
    this.type('bin');
  }

  const buffer = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;

  // Strong-ish caching for GET/HEAD: hash the body into a weak ETag.
  const cacheable = (req.method === 'GET' || req.method === 'HEAD')
    && this.statusCode >= 200 && this.statusCode < 300;
  if (cacheable && buffer.length > 0 && !this.get('ETag') && this.app.enabled('etag')) {
    const hash = crypto.createHash('sha1').update(buffer).digest('base64').slice(0, 27);
    this.setHeader('ETag', `W/"${buffer.length.toString(16)}-${hash}"`);
  }
  if (cacheable && this.get('ETag') && req.headers['if-none-match'] === this.get('ETag')) {
    this.statusCode = 304;
  }

  if (this.statusCode === 204 || this.statusCode === 304) {
    this.removeHeader('Content-Type');
    this.removeHeader('Content-Length');
    this.removeHeader('Transfer-Encoding');
    this.end();
    return this;
  }

  this.setHeader('Content-Length', buffer.length);
  if (req.method === 'HEAD') this.end();
  else this.end(buffer);
  return this;
};

/** Send JSON, honouring the app's "json spaces" and "json replacer" settings. */
res.json = function json(obj) {
  const app = this.app;
  const body = JSON.stringify(obj, app.get('json replacer'), app.get('json spaces'));
  if (!this.get('Content-Type')) this.set('Content-Type', 'application/json');
  return this.send(body === undefined ? '' : body);
};

/** Set the status and send its standard text, e.g. res.sendStatus(404) -> "Not Found". */
res.sendStatus = function sendStatus(code) {
  this.status(code);
  return this.type('txt').send(http.STATUS_CODES[code] || String(code));
};

res.location = function location(url) {
  if (url === 'back') url = this.req.get('Referrer') || '/';
  return this.set('Location', encodeURI(url));
};

/** Redirect to `url` with an optional status (default 302). */
res.redirect = function redirect(status, url) {
  if (url === undefined) {
    url = status;
    status = 302;
  }
  this.location(url).status(status);
  const href = escapeHtml(this.get('Location'));
  const accepts = this.req.accepts('html', 'text');
  if (accepts === 'html') this.type('html').send(`<p>${http.STATUS_CODES[status]}. Redirecting to <a href="${href}">${href}</a></p>`);
  else this.type('txt').send(`${http.STATUS_CODES[status]}. Redirecting to ${this.get('Location')}`);
};

/**
 * Set a cookie. Objects are JSON-encoded with a "j:" prefix like Express.
 * Options: maxAge (ms), expires, path, domain, httpOnly, secure, sameSite.
 */
res.cookie = function cookie(name, value, options = {}) {
  const opts = { path: '/', ...options };
  const val = typeof value === 'object' ? 'j:' + JSON.stringify(value) : String(value);

  let str = `${name}=${encodeURIComponent(val)}`;
  if (opts.maxAge != null) {
    const seconds = Math.floor(opts.maxAge / 1000);
    str += `; Max-Age=${seconds}`;
    opts.expires = new Date(Date.now() + opts.maxAge);
  }
  if (opts.domain) str += `; Domain=${opts.domain}`;
  if (opts.path) str += `; Path=${opts.path}`;
  if (opts.expires) str += `; Expires=${opts.expires.toUTCString()}`;
  if (opts.httpOnly) str += '; HttpOnly';
  if (opts.secure) str += '; Secure';
  if (opts.sameSite) {
    const s = opts.sameSite === true ? 'Strict' : String(opts.sameSite);
    str += `; SameSite=${s[0].toUpperCase()}${s.slice(1).toLowerCase()}`;
  }
  return this.append('Set-Cookie', str);
};

res.clearCookie = function clearCookie(name, options = {}) {
  const { maxAge, ...rest } = options;
  return this.cookie(name, '', { ...rest, expires: new Date(1) });
};

/**
 * Stream a file. `filePath` must be absolute unless `options.root` is set.
 * Errors go to `callback`, or to next(err) if no callback is given.
 */
res.sendFile = function sendFileMethod(filePath, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  options = options || {};
  const req = this.req;
  const done = callback || ((err) => err && req.next(err));

  if (!options.root && !path.isAbsolute(filePath)) {
    throw new TypeError('path must be absolute or specify root to res.sendFile');
  }

  let full;
  if (options.root) {
    const root = path.resolve(options.root);
    full = path.join(root, filePath);
    if (!full.startsWith(root + path.sep) && full !== root) {
      return done(createError(403, 'Forbidden'));
    }
  } else {
    full = filePath;
  }

  fs.stat(full, (err, stat) => {
    if (err || stat.isDirectory()) return done(createError(404, 'File not found', { path: full }));
    sendFile(req, this, full, stat, options, done);
  });
};

/** Send a file as an attachment (Content-Disposition), prompting a download. */
res.download = function download(filePath, filename, callback) {
  if (typeof filename === 'function') {
    callback = filename;
    filename = undefined;
  }
  const name = filename || path.basename(filePath);
  this.set('Content-Disposition', `attachment; filename="${name.replace(/"/g, '')}"`);
  return this.sendFile(path.resolve(filePath), {}, callback);
};

module.exports = res;
