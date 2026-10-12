'use strict';

const fs = require('fs');
const mime = require('./mime');

/**
 * Stream a file to the response with caching headers. Handles conditional
 * GET (If-None-Match / If-Modified-Since -> 304) and HEAD requests.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} filePath  absolute path
 * @param {fs.Stats} stat
 * @param {{ maxAge?: number, headers?: object }} options
 * @param {(err?: Error) => void} callback  called once the response is finished or failed
 */
function sendFile(req, res, filePath, stat, options, cb) {
  let called = false;
  const callback = (err) => {
    if (called) return;
    called = true;
    cb(err);
  };
  const etag = `W/"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
  const lastModified = stat.mtime.toUTCString();

  if (!res.getHeader('Content-Type')) {
    res.setHeader('Content-Type', mime.contentType(mime.lookup(filePath) || 'bin'));
  }
  res.setHeader('ETag', etag);
  res.setHeader('Last-Modified', lastModified);
  res.setHeader('Cache-Control', `public, max-age=${Math.floor((options.maxAge || 0) / 1000)}`);
  for (const [name, value] of Object.entries(options.headers || {})) res.setHeader(name, value);

  if (isFresh(req, etag, stat.mtime)) {
    res.statusCode = 304;
    res.removeHeader('Content-Type');
    res.end();
    return callback();
  }

  res.setHeader('Content-Length', stat.size);
  if (req.method === 'HEAD') {
    res.end();
    return callback();
  }

  const stream = fs.createReadStream(filePath);
  stream.on('error', (err) => {
    stream.destroy();
    callback(err);
  });
  res.on('finish', () => callback());
  stream.pipe(res);
}

function isFresh(req, etag, mtime) {
  const noneMatch = req.headers['if-none-match'];
  if (noneMatch) return noneMatch.split(',').some((t) => t.trim() === etag || t.trim() === '*');
  const since = Date.parse(req.headers['if-modified-since']);
  return !Number.isNaN(since) && Math.floor(mtime.getTime() / 1000) * 1000 <= since;
}

module.exports = sendFile;
