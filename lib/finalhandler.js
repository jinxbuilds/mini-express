'use strict';

const http = require('http');
const { escapeHtml, getPathname } = require('./utils');

/**
 * The handler of last resort, run when the router stack is exhausted:
 * a 404 if nothing responded, or an error page if next(err) was called.
 */
function finalhandler(req, res, { env, onerror } = {}) {
  return function done(err) {
    let status;
    let message;

    if (err) {
      status = getErrorStatus(err) || 500;
      if (onerror) onerror(err, req, res);
      // Hide internals in production unless the error is marked safe to expose.
      message = env === 'production' && !err.expose
        ? http.STATUS_CODES[status]
        : (env === 'production' ? err.message : err.stack || String(err));
    } else {
      status = 404;
      message = `Cannot ${req.method} ${getPathname(req.originalUrl || req.url)}`;
    }

    if (res.headersSent) {
      // Too late to send an error page; drop the connection.
      req.socket.destroy();
      return;
    }

    const body = Buffer.from(
      '<!DOCTYPE html>\n<html lang="en">\n<head><meta charset="utf-8"><title>Error</title></head>\n'
      + `<body><pre>${escapeHtml(message).replace(/\n/g, '<br>').replace(/ {2}/g, ' &nbsp;')}</pre></body>\n</html>\n`,
    );

    // Start from a clean slate: headers set by earlier middleware don't apply.
    for (const name of res.getHeaderNames()) res.removeHeader(name);
    if (err && err.headers) for (const [k, v] of Object.entries(err.headers)) res.setHeader(k, v);

    res.statusCode = status;
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Length', body.length);

    if (req.method === 'HEAD') res.end();
    else res.end(body);
  };
}

function getErrorStatus(err) {
  const status = err.status || err.statusCode;
  return Number.isInteger(status) && status >= 400 && status < 600 ? status : undefined;
}

module.exports = finalhandler;
