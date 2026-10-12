'use strict';

const http = require('http');
const mime = require('./utils/mime');
const { getPathname, parseQuery, mimeOf } = require('./utils');

/**
 * Prototype for `req`. Every incoming request has its prototype swapped to
 * this object (which itself inherits from http.IncomingMessage), giving it
 * helpers like req.query, req.path and req.get().
 */
const req = Object.create(http.IncomingMessage.prototype);

/** Get a request header, case-insensitively. `Referer`/`Referrer` are aliases. */
req.get = req.header = function header(name) {
  if (typeof name !== 'string') throw new TypeError('name argument is required to req.get');
  const lc = name.toLowerCase();
  if (lc === 'referer' || lc === 'referrer') return this.headers.referrer || this.headers.referer;
  return this.headers[lc];
};

/** Does the request body's Content-Type match `type` ("json", "text/*", ...)? */
req.is = function is(...types) {
  const actual = mimeOf(this.headers['content-type']);
  if (!actual) return false;
  for (const type of types.flat()) {
    const wanted = type.includes('/') ? type : mime.lookup(type);
    if (!wanted) continue;
    if (wanted === actual) return type;
    const [wt, ws] = wanted.split('/');
    const [at, as] = actual.split('/');
    if ((wt === '*' || wt === at) && (ws === '*' || ws === as)) return type;
    if (ws.startsWith('*+') && as.endsWith(ws.slice(1))) return type;
  }
  return false;
};

/**
 * Content negotiation: return the best of `types` for the Accept header,
 * honouring q-values, or `false` if none is acceptable.
 */
req.accepts = function accepts(...types) {
  types = types.flat();
  const header = this.headers.accept;
  if (!header) return types[0] || '*/*';

  const ranges = header
    .split(',')
    .map((part, i) => {
      const [range, ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      return { range: range.trim().toLowerCase(), q: q ? Number(q.slice(2)) : 1, i };
    })
    .filter((r) => r.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);

  if (types.length === 0) return ranges.map((r) => r.range);

  for (const { range } of ranges) {
    const [rt, rs] = range.split('/');
    for (const type of types) {
      const full = type.includes('/') ? type : mime.lookup(type);
      if (!full) continue;
      const [tt, ts] = full.split('/');
      if ((rt === '*' || rt === tt) && (rs === '*' || rs === ts)) return type;
    }
  }
  return false;
};

defineGetter(req, 'query', function query() {
  const q = this.url.indexOf('?');
  return q === -1 ? Object.create(null) : parseQuery(this.url.slice(q + 1));
});

defineGetter(req, 'path', function path() {
  return getPathname(this.url);
});

defineGetter(req, 'protocol', function protocol() {
  const proto = this.socket && this.socket.encrypted ? 'https' : 'http';
  if (!this.app.enabled('trust proxy')) return proto;
  const header = this.headers['x-forwarded-proto'];
  return header ? header.split(',')[0].trim() : proto;
});

defineGetter(req, 'secure', function secure() {
  return this.protocol === 'https';
});

defineGetter(req, 'ip', function ip() {
  if (this.app.enabled('trust proxy')) {
    const forwarded = this.headers['x-forwarded-for'];
    if (forwarded) return forwarded.split(',')[0].trim();
  }
  return this.socket ? this.socket.remoteAddress : undefined;
});

defineGetter(req, 'hostname', function hostname() {
  let host = this.app.enabled('trust proxy') && this.headers['x-forwarded-host'];
  host = host || this.headers.host;
  if (!host) return undefined;
  // IPv6 literals look like "[::1]:3000".
  const end = host[0] === '[' ? host.indexOf(']') + 1 : 0;
  const colon = host.indexOf(':', end);
  return colon === -1 ? host : host.slice(0, colon);
});

defineGetter(req, 'xhr', function xhr() {
  return (this.headers['x-requested-with'] || '').toLowerCase() === 'xmlhttprequest';
});

function defineGetter(obj, name, getter) {
  Object.defineProperty(obj, name, { configurable: true, enumerable: true, get: getter });
}

module.exports = req;
