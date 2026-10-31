'use strict';

// Minimal static server for the harness: serves the repository root so the
// app and tests/ share one origin (the service worker and the frame guard
// both look at origins). Beacons are answered with 204 and collected by
// tests/run.js from the page's network events, not from the server log.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function handler(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (err) {
    res.writeHead(400).end();
    return;
  }
  if (pathname.startsWith('/tests/beacon/')) {
    res.writeHead(204, { 'cache-control': 'no-store' });
    res.end();
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = path.join(ROOT, path.normalize(pathname));
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'content-length': st.size,
      'cache-control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
  });
}

// Two listeners on the same handler give the tests a second origin
// (127.0.0.1:otherPort) for the cross-origin frame check.
function startServers(count) {
  const servers = [];
  const ports = [];
  let pending = count;
  return new Promise((resolve, reject) => {
    for (let i = 0; i < count; i++) {
      const srv = http.createServer(handler);
      srv.keepAliveTimeout = 2000;
      srv.on('error', reject);
      srv.listen(0, '127.0.0.1', () => {
        servers.push(srv);
        ports.push(srv.address().port);
        if (--pending === 0) {
          resolve({
            ports,
            origin: (i) => 'http://127.0.0.1:' + ports[i],
            close: () => Promise.all(servers.map((s) => new Promise((r) => s.close(r)))),
          });
        }
      });
    }
  });
}

module.exports = { startServers, handler, ROOT };
