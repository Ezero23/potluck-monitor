'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const workerUrl = pathToFileURL(path.resolve(__dirname, '../../worker/src/index.js')).href;
const SECRET = 'worker-ingest-test-secret';

function mockStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    async get(key) { return map.get(key); },
    async put(key, value) {
      if (typeof key === 'string') {
        map.set(key, value);
        return;
      }
      for (const [entryKey, entryValue] of Object.entries(key)) map.set(entryKey, entryValue);
    },
    async delete(key) { map.delete(key); },
    async list(options) {
      const prefix = options?.prefix || '';
      return new Map([...map].filter(([key]) => key.startsWith(prefix)));
    }
  };
}

async function createHub(storage = mockStorage()) {
  const worker = await import(workerUrl);
  const hub = new worker.HubDO({ storage }, { TOKEN_MONITOR_SECRET: SECRET });
  return { hub, storage };
}

function ingestRequest(payload, options = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return new Request('https://example.com/api/ingest', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-token-monitor-secret': SECRET,
      ...(options.contentLength ? { 'content-length': String(options.contentLength) } : {})
    },
    body
  });
}

function externalSnapshot(overrides = {}) {
  return {
    deviceId: 'gateway-1',
    updatedAt: new Date().toISOString(),
    limits: {
      schemaVersion: 2,
      snapshotId: 'snap-1',
      snapshotType: 'full',
      sourceInstanceId: 'potluck:gateway',
      generatedAt: new Date().toISOString(),
      providers: [{
        provider: 'opencode',
        connectionKey: 'conn-1',
        accountKey: 'sha256:acct-1',
        status: 'ok',
        source: 'api',
        updatedAt: new Date().toISOString(),
        windows: [{ kind: 'billing', usedPercent: 40, remainingPercent: 60 }]
      }]
    },
    ...overrides
  };
}

test('worker ingest rejects non-object JSON bodies', async () => {
  const { hub } = await createHub();
  for (const body of ['"text"', '[1,2]', '42', 'null']) {
    const response = await hub.fetch(ingestRequest(body));
    assert.equal(response.status, 400, body);
    assert.equal((await response.json()).error, 'bad_request');
  }
});

test('worker ingest caps bodies at 1 MiB like the Node hub', async () => {
  const { hub } = await createHub();
  const oversized = JSON.stringify({ deviceId: 'big', padding: 'x'.repeat(1024 * 1024) });
  const response = await hub.fetch(ingestRequest(oversized));
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error, 'payload_too_large');

  const { hub: headerHub } = await createHub();
  const declared = await headerHub.fetch(ingestRequest('{"deviceId":"x"}', { contentLength: 2 * 1024 * 1024 }));
  assert.equal(declared.status, 413);
});

test('worker ingest routes external snapshots through the adapter', async () => {
  const { hub, storage } = await createHub();
  const response = await hub.fetch(ingestRequest(externalSnapshot()));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);

  const record = storage.map.get('dev:gateway-1');
  assert.ok(record, 'device record stored');
  assert.equal(record.limits.providers.length, 1);
  assert.equal(record.limits.providers[0].managedBy, 'potluck');
  const state = storage.map.get('extsnap:gateway-1');
  assert.ok(state, 'snapshot state persisted');
  assert.equal(state['potluck:gateway'].snapshotId, 'snap-1');
});

test('worker ingest skips duplicate external snapshots idempotently', async () => {
  const { hub, storage } = await createHub();
  const first = await hub.fetch(ingestRequest(externalSnapshot()));
  assert.equal(first.status, 200);
  const stored = storage.map.get('dev:gateway-1');
  const receivedAt = stored.receivedAt;

  const duplicate = await hub.fetch(ingestRequest(externalSnapshot()));
  assert.equal(duplicate.status, 200);
  const payload = await duplicate.json();
  assert.equal(payload.skipped, 'duplicate');
  assert.equal(storage.map.get('dev:gateway-1').receivedAt, receivedAt, 'stored record untouched');
});

test('worker ingest rejects external snapshots carrying credential fields', async () => {
  const { hub, storage } = await createHub();
  const snapshot = externalSnapshot();
  snapshot.limits.providers[0].apiKey = 'sk-live-secret';
  const response = await hub.fetch(ingestRequest(snapshot));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'invalid_limits_snapshot');
  assert.equal(storage.map.has('dev:gateway-1'), false, 'rejected snapshot must not store anything');
});

test('worker ingest normalizes the monitor envelope like the Node hub', async () => {
  const { hub, storage } = await createHub();
  const response = await hub.fetch(ingestRequest({
    deviceId: 'mon-1',
    updatedAt: new Date().toISOString(),
    monitor: {
      events: [{ id: 'evt-1', type: 'health_event', status: 'success' }],
      junkField: 'dropped'
    }
  }));
  assert.equal(response.status, 200);
  const record = storage.map.get('dev:mon-1');
  assert.equal(record.monitor.schemaVersion, 1);
  assert.equal(record.monitor.events.length, 1);
  assert.equal(record.monitor.events[0].id, 'evt-1');
  assert.equal(Object.hasOwn(record.monitor, 'junkField'), false);

  const { hub: hub2, storage: storage2 } = await createHub();
  const invalid = await hub2.fetch(ingestRequest({
    deviceId: 'mon-2',
    updatedAt: new Date().toISOString(),
    monitor: { nope: true }
  }));
  assert.equal(invalid.status, 200);
  assert.equal(Object.hasOwn(storage2.map.get('dev:mon-2'), 'monitor'), false, 'empty envelope dropped');
});

test('worker ingest rejects merged records beyond the DO value limit', async () => {
  const { hub } = await createHub();
  const sessions = {};
  for (let index = 0; index < 4000; index += 1) {
    sessions[`codex:session-${index}`] = {
      client: 'codex',
      sessionId: `session-${index}`,
      totalTokens: index,
      lastUsedAt: '2026-10-02T00:00:00.000Z'
    };
  }
  const response = await hub.fetch(ingestRequest({
    deviceId: 'huge-1',
    updatedAt: new Date().toISOString(),
    today: { totalTokens: 1, sessions }
  }));
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error, 'record_too_large');
});

test('worker ingest still stores a normal device record', async () => {
  const { hub, storage } = await createHub();
  const response = await hub.fetch(ingestRequest({
    deviceId: 'plain-1',
    updatedAt: new Date().toISOString(),
    today: { totalTokens: 123, costUsd: 0.5, clients: { codex: 123 }, models: { 'gpt-5': 123 } }
  }));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.deviceId, 'plain-1');
  assert.equal(storage.map.get('dev:plain-1').periods.today.totalTokens, 123);
});
