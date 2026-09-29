'use strict';
/**
 * snip-api — a tiny URL shortener.
 * It is deliberately boring: the interesting part of this repo is the
 * DevOps around it (Docker, CI/CD, Terraform, monitoring).
 * Zero runtime dependencies — only Node.js built-ins.
 */
const http = require('node:http');
const { randomBytes } = require('node:crypto');

const PORT = Number(process.env.PORT) || 8080;
const MAX_BODY = 1024 * 1024; // 1 MB

const links = new Map(); // code -> { url, hits, createdAt }
const startedAt = Date.now();
let httpRequestsTotal = 0;
const requestsByRoute = new Map();

function countRequest(route) {
  httpRequestsTotal += 1;
  requestsByRoute.set(route, (requestsByRoute.get(route) || 0) + 1);
}

function renderMetrics() {
  const out = [
    '# HELP http_requests_total Total HTTP requests received.',
    '# TYPE http_requests_total counter',
    `http_requests_total ${httpRequestsTotal}`,
    '# HELP http_requests_by_route HTTP requests by route.',
    '# TYPE http_requests_by_route counter',
  ];
  for (const [route, n] of requestsByRoute) {
    out.push(`http_requests_by_route{route="${route}"} ${n}`);
  }
  out.push(
    '# HELP process_uptime_seconds Seconds since the process started.',
    '# TYPE process_uptime_seconds gauge',
    `process_uptime_seconds ${Math.floor((Date.now() - startedAt) / 1000)}`,
    '# HELP snip_links_total Short links currently stored.',
    '# TYPE snip_links_total gauge',
    `snip_links_total ${links.size}`,
  );
  return out.join('\n') + '\n';
}

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function newCode() {
  return randomBytes(4).toString('base64url');
}

async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;

  if (req.method === 'GET' && path === '/healthz') {
    countRequest('GET /healthz');
    return json(res, 200, { status: 'ok' });
  }

  if (req.method === 'GET' && path === '/metrics') {
    countRequest('GET /metrics');
    const body = renderMetrics();
    res.writeHead(200, {
      'content-type': 'text/plain; version=0.0.4; charset=utf-8',
      'content-length': Buffer.byteLength(body),
    });
    return res.end(body);
  }

  if (req.method === 'GET' && path === '/') {
    countRequest('GET /');
    return json(res, 200, {
      name: 'snip-api',
      description: 'Tiny URL shortener — deploy payload for the GCP DevOps pipeline project',
      endpoints: ['POST /shorten', 'GET /:code', 'GET /healthz', 'GET /metrics'],
    });
  }

  if (req.method === 'POST' && path === '/shorten') {
    countRequest('POST /shorten');
    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch {
      return json(res, 400, { error: 'invalid JSON body' });
    }
    let target;
    try {
      target = new URL(payload.url);
    } catch {
      return json(res, 400, { error: 'url must be a valid absolute URL' });
    }
    if (!['http:', 'https:'].includes(target.protocol)) {
      return json(res, 400, { error: 'only http(s) URLs can be shortened' });
    }
    const code = newCode();
    links.set(code, { url: target.toString(), hits: 0, createdAt: new Date().toISOString() });
    const host = req.headers.host || `localhost:${PORT}`;
    return json(res, 201, { code, short_url: `https://${host}/${code}` });
  }

  const match = path.match(/^\/([A-Za-z0-9_-]{6})$/);
  if (req.method === 'GET' && match) {
    countRequest('GET /:code');
    const link = links.get(match[1]);
    if (!link) return json(res, 404, { error: 'unknown code' });
    link.hits += 1;
    res.writeHead(302, { location: link.url });
    return res.end();
  }

  countRequest('unknown');
  return json(res, 404, { error: 'not found' });
}

function createServer() {
  return http.createServer((req, res) => {
    handler(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) json(res, 500, { error: 'internal error' });
    });
  });
}

if (require.main === module) {
  const server = createServer();
  server.listen(PORT, () => console.log(`snip-api listening on :${PORT}`));
}

module.exports = { createServer };
