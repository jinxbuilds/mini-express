'use strict';

const fs = require('fs');
const path = require('path');
const sendFile = require('../utils/send-file');

/**
 * Serve files from `root`. Falls through to the next middleware when a file
 * isn't found, so it composes with routes.
 *
 * @param {string} root
 * @param {{ index?: string|false, maxAge?: number, dotfiles?: 'ignore'|'allow', redirect?: boolean }} [options]
 */
function serveStatic(root, options = {}) {
  if (!root) throw new TypeError('root path required');
  const rootPath = path.resolve(root);
  const { index = 'index.html', maxAge = 0, dotfiles = 'ignore', redirect = true } = options;

  return function staticMiddleware(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    let pathname;
    try {
      pathname = decodeURIComponent(req.path);
    } catch {
      return next();
    }
    if (pathname.includes('\0')) return next();

    // Resolve inside root, refusing anything that escapes it ("/../../etc/passwd").
    const filePath = path.join(rootPath, path.normalize('/' + pathname));
    if (filePath !== rootPath && !filePath.startsWith(rootPath + path.sep)) return next();

    if (dotfiles !== 'allow' && pathname.split('/').some((seg) => seg.startsWith('.') && seg.length > 1)) {
      return next();
    }

    fs.stat(filePath, (err, stat) => {
      if (err) return next();

      if (stat.isDirectory()) {
        if (!pathname.endsWith('/')) {
          if (!redirect) return next();
          // "/docs" -> "/docs/" so relative links inside index.html resolve.
          const [p, q] = (req.originalUrl || req.url).split('?');
          return res.redirect(301, p + '/' + (q ? '?' + q : ''));
        }
        if (!index) return next();
        const indexPath = path.join(filePath, index);
        return fs.stat(indexPath, (indexErr, indexStat) => {
          if (indexErr || !indexStat.isFile()) return next();
          sendFile(req, res, indexPath, indexStat, { maxAge }, (e) => e && next(e));
        });
      }

      sendFile(req, res, filePath, stat, { maxAge }, (e) => e && next(e));
    });
  };
}

module.exports = serveStatic;
