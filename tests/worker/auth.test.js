'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const workerUrl = pathToFileURL(path.resolve(__dirname, '../../worker/src/index.js')).href;

function mockStorage() {
  const map = new Map();
  return {
    async get(key) { return map.get(key); },
    async put(key, value) {
      if (typeof key === 'string') { map.set(key, value); return; }
      for (const [entryKey, entryValue] of Object.entries(key)) map.set(entryKey, entryValue);
    },
    async delete(key) { map.delete(key); },
    async list(options) {
      const prefix = options?.prefix || '';
      return new Map([...map].filter(([key]) => key.startsWith(prefix)));
    }
  };
}

test('worker accepts bearer and x-token-monitor-secret headers', async () => {
  const worker = await import(workerUrl);
  const hub = new worker.HubDO({ storage: mockStorage() }, { TOKEN_MONITOR_SECRET: 's3cret' });

  const bearer = await hub.fetch(new Request('https://example.com/api/stats', {
    headers: { authorization: 'Bearer s3cret' }
  }));
  assert.equal(bearer.status, 200);

  const header = await hub.fetch(new Request('https://example.com/api/stats', {
    headers: { 'x-token-monitor-secret': 's3cret' }
  }));
  assert.equal(header.status, 200);
});

test('worker accepts a query-string secret only as the iOS compatibility entry point', async () => {
  const worker = await import(workerUrl);
  const hub = new worker.HubDO({ storage: mockStorage() }, { TOKEN_MONITOR_SECRET: 's3cret' });

  const viaQuery = await hub.fetch(new Request('https://example.com/api/stats?secret=s3cret'));
  assert.equal(viaQuery.status, 200);

  const wrong = await hub.fetch(new Request('https://example.com/api/stats?secret=wrong'));
  assert.equal(wrong.status, 401);

  const missing = await hub.fetch(new Request('https://example.com/api/stats'));
  assert.equal(missing.status, 401);
});

test('worker refuses all data routes when no secret is configured', async () => {
  const worker = await import(workerUrl);
  const hub = new worker.HubDO({ storage: mockStorage() }, {});
  for (const route of ['/api/stats', '/api/devices', '/api/history']) {
    const response = await hub.fetch(new Request(`https://example.com${route}`));
    assert.equal(response.status, 503, route);
    assert.equal((await response.json()).error, 'secret_required');
  }
  const health = await hub.fetch(new Request('https://example.com/api/health'));
  assert.equal(health.status, 200);
});
