'use strict';

process.env.NODE_ENV = 'test';

const http = require('http');

/**
 * Start `app` on an ephemeral port, run one request, and shut down.
 * Returns { status, headers, text, body } where body is parsed JSON when possible.
 */
async function request(app, path, { method = 'GET', headers = {}, body } = {}) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const init = { method, headers: { ...headers }, redirect: 'manual' };
    if (body !== undefined) {
      if (typeof body === 'string' || Buffer.isBuffer(body)) {
        init.body = body;
      } else {
        init.body = JSON.stringify(body);
        init.headers['content-type'] = init.headers['content-type'] || 'application/json';
      }
    }
    const res = await fetch(`http://127.0.0.1:${port}${path}`, init);
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = undefined; }
    return { status: res.status, headers: res.headers, text, body: parsed };
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

module.exports = { request };
