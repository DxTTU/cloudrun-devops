'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('./server');

describe('snip-api', () => {
  let server;
  let base;

  before(async () => {
    server = createServer();
    await new Promise((resolve) => server.listen(0, resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => server.close());

  it('GET / describes the service', async () => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.name, 'snip-api');
  });

  it('GET /healthz returns ok', async () => {
    const res = await fetch(`${base}/healthz`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ok' });
  });

  it('shortens a URL and redirects to it', async () => {
    const res = await fetch(`${base}/shorten`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com' }),
    });
    assert.equal(res.status, 201);
    const { code, short_url } = await res.json();
    assert.match(code, /^[A-Za-z0-9_-]{6}$/);
    assert.ok(short_url.endsWith(`/${code}`));

    const redir = await fetch(`${base}/${code}`, { redirect: 'manual' });
    assert.equal(redir.status, 302);
    assert.equal(redir.headers.get('location'), 'https://example.com/');
  });

  it('rejects invalid URLs', async () => {
    const res = await fetch(`${base}/shorten`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'not-a-url' }),
    });
    assert.equal(res.status, 400);
  });

  it('rejects non-http(s) URLs', async () => {
    const res = await fetch(`${base}/shorten`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'ftp://example.com/x' }),
    });
    assert.equal(res.status, 400);
  });

  it('unknown code returns 404', async () => {
    const res = await fetch(`${base}/zzzzzz`);
    assert.equal(res.status, 404);
  });

  it('GET /metrics exposes Prometheus counters', async () => {
    const res = await fetch(`${base}/metrics`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /http_requests_total \d+/);
    assert.match(text, /snip_links_total \d+/);
  });
});
