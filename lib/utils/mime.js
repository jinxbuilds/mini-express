'use strict';

const types = {
  html: 'text/html',
  htm: 'text/html',
  txt: 'text/plain',
  text: 'text/plain',
  css: 'text/css',
  csv: 'text/csv',
  md: 'text/markdown',
  js: 'text/javascript',
  mjs: 'text/javascript',
  json: 'application/json',
  map: 'application/json',
  xml: 'application/xml',
  pdf: 'application/pdf',
  zip: 'application/zip',
  wasm: 'application/wasm',
  bin: 'application/octet-stream',
  form: 'application/x-www-form-urlencoded',
  urlencoded: 'application/x-www-form-urlencoded',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  webm: 'video/webm',
};

const TEXT_TYPES = /^text\/|^application\/(json|javascript|xml)|\+json$|\+xml$/;

/** Look up a MIME type by extension ("html", ".html") or file path ("a/b.css"). */
function lookup(extOrPath) {
  const ext = String(extOrPath).split('.').pop().toLowerCase();
  return types[ext];
}

/** Full Content-Type value, adding a charset for text types. */
function contentType(type) {
  const mime = type.includes('/') ? type : lookup(type) || 'application/octet-stream';
  if (mime.includes('charset') || !TEXT_TYPES.test(mime)) return mime;
  return `${mime}; charset=utf-8`;
}

module.exports = { types, lookup, contentType };
