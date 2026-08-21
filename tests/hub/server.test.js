'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const { createHub, resolveBindHost, buildHubLimitsSnapshot, LIMITS_SNAPSHOT_SCHEMA_VERSION } = require('../../src/hub/server');
const { codexAccountKey } = require('../../src/shared/codexAuth');

function tempDataFile() {
  return path.join(os.tmpdir(), `tm-hub-test-${process.pid}-${Math.random().toString(16).slice(2)}.json`);
}

test('resolveBindHost keeps the requested host when a secret is set', () => {
  assert.equal(resolveBindHost('0.0.0.0', 's3cret'), '0.0.0.0');
  assert.equal(resolveBindHost('192.168.1.10', 's3cret'), '192.168.1.10');
});

test('resolveBindHost forces localhost when no secret and a non-loopback host is requested', () => {
  assert.equal(resolveBindHost('0.0.0.0', ''), '127.0.0.1');
  assert.equal(resolveBindHost('192.168.1.10', ''), '127.0.0.1');
  assert.equal(resolveBindHost('', ''), '127.0.0.1');
});

test('resolveBindHost leaves an already-loopback host unchanged without a secret', () => {
  assert.equal(resolveBindHost('127.0.0.1', ''), '127.0.0.1');
  assert.equal(resolveBindHost('localhost', ''), 'localhost');
  assert.equal(resolveBindHost('::1', ''), '::1');
});

test('a hub without a secret binds to localhost only even when asked to bind every interface', async () => {
  const dataFile = tempDataFile();
  const hub = createHub({ port: 0, host: '0.0.0.0', secret: '', dataFile, logger: { error() {}, warn() {} } });
  await hub.start();
  try {
    assert.equal(hub.bindHost, '127.0.0.1');
    assert.equal(hub.server.address().address, '127.0.0.1');
  } finally {
    await hub.stop();
    fs.rmSync(dataFile, { force: true });
  }
});

test('ingest inserts a device and is visible in getStats', () => {
  const dataFile = tempDataFile();
  const hub = createHub({ port: 0, host: '127.0.0.1', secret: '', dataFile, logger: { error() {} } });
  try {
    const record = hub.ingest({ deviceId: 'dev-a', today: { totalTokens: 5, costUsd: 0.1 } });
    assert.equal(record.deviceId, 'dev-a');
    assert.equal(hub.getStats().devices.length, 1);
  } finally {
    fs.rmSync(dataFile, { force: true });
  }
});

test('getStats exposes the effective staleness threshold', () => {
  const dataFile = tempDataFile();
  const hub = createHub({ port: 0, host: '127.0.0.1', secret: '', staleAfterMs: 123456, dataFile, logger: { error() {} } });
  try {
    assert.equal(hub.getStats().staleAfterMs, 123456);
  } finally {
    fs.rmSync(dataFile, { force: true });
  }
});

test('Hub keeps same-email Codex Personal and Team workspaces distinct across devices', () => {
  const dataFile = tempDataFile();
  const hub = createHub({ port: 0, host: '127.0.0.1', secret: '', staleAfterMs: 0, dataFile, logger: { error() {} } });
  const email = 'member@example.com';
  const personalKey = codexAccountKey(email, 'workspace-personal');
  const teamKey = codexAccountKey(email, 'workspace-team');
  const provider = (accountKey, remainingPercent, updatedAt) => ({
    provider: 'codex',
    accountKey,
    accountEmail: email,
    status: 'ok',
    source: 'rpc',
    sourceDetail: 'managed',
    updatedAt,
    windows: [{ kind: 'weekly', usedPercent: 100 - remainingPercent, remainingPercent }]
  });
  try {
    hub.ingest({
      deviceId: 'macbook',
      limits: {
        updatedAt: '2026-07-24T10:01:00.000Z',
        providers: [
          provider(personalKey, 18, '2026-07-24T10:00:00.000Z'),
          provider(teamKey, 72, '2026-07-24T10:01:00.000Z')
        ]
      }
    });
    hub.ingest({
      deviceId: 'desktop',
      limits: {
        updatedAt: '2026-07-24T10:05:00.000Z',
        providers: [
          provider(personalKey, 48, '2026-07-24T10:04:00.000Z'),
          provider(teamKey, 82, '2026-07-24T10:05:00.000Z')
        ]
      }
    });

    const codexProviders = hub.getStats().limits.providers.filter((entry) => entry.provider === 'codex');
    assert.equal(codexProviders.length, 2);
    assert.deepEqual(
      new Set(codexProviders.map((entry) => entry.accountKey)),
      new Set([personalKey, teamKey])
    );
    assert.equal(
      codexProviders.find((entry) => entry.accountKey === personalKey).windows[0].remainingPercent,
      48
    );
    assert.equal(
      codexProviders.find((entry) => entry.accountKey === teamKey).windows[0].remainingPercent,
      82
    );
    assert.ok(codexProviders.every((entry) => entry.sourceDeviceId === 'desktop'));
  } finally {
    fs.rmSync(dataFile, { force: true });
  }
});

test('Hub aggregates quota pools by key, keeps same-label pools distinct, and drops deleted live pools', () => {
  const dataFile = tempDataFile();
  const hub = createHub({ port: 0, host: '127.0.0.1', secret: '', staleAfterMs: 0, dataFile, logger: { error() {} } });
  const poolWindow = (usedPercent) => [{ kind: 'session', usedPercent, remainingPercent: 100 - usedPercent }];
  const ingestClaude = (deviceId, poolKey, label, usedPercent, connectionKey, updatedAt) => {
    hub.ingest({
      deviceId,
      updatedAt,
      limits: {
        schemaVersion: 2,
        snapshotType: 'full',
        snapshotId: `${deviceId}-${updatedAt}`,
        sourceInstanceId: `monitor:${deviceId}`,
        updatedAt,
        quotaPools: [{
          quotaPoolKey: poolKey,
          provider: 'claude',
          label,
          connectionKeys: [connectionKey],
          windows: poolWindow(usedPercent)
        }],
        providers: [{
          provider: 'claude',
          connectionKey,
          accountKey: connectionKey,
          quotaPoolKey: poolKey,
          accountLabel: label,
          status: 'ok',
          updatedAt,
          windows: poolWindow(usedPercent)
        }]
      }
    });
  };
  try {
    ingestClaude('mac', 'pool-team', 'Team', 12, 'monitor:mac:conn-a', '2026-08-19T10:00:00.000Z');
    ingestClaude('pc', 'pool-team', '团队', 40, 'monitor:pc:conn-b', '2026-08-19T10:05:00.000Z');
    ingestClaude('laptop', 'pool-other', 'Team', 12, 'monitor:laptop:conn-c', '2026-08-19T10:05:00.000Z');

    const stats = hub.getStats();
    const pools = stats.limits.quotaPools;
    assert.equal(pools.length, 2);
    const team = pools.find((pool) => pool.quotaPoolKey === 'pool-team');
    const other = pools.find((pool) => pool.quotaPoolKey === 'pool-other');
    assert.equal(team.windows[0].usedPercent, 40);
    assert.equal(team.conflict, true);
    assert.deepEqual(team.connectionKeys, ['monitor:mac:conn-a', 'monitor:pc:conn-b']);
    assert.equal(other.label, 'Team');
    assert.equal(stats.limits.providers.filter((row) => row.quotaPoolKey === 'pool-team').every((row) => row.windows[0].usedPercent === 40), true);

    hub.ingest({
      deviceId: 'mac',
      updatedAt: '2026-08-19T11:00:00.000Z',
      limits: {
        schemaVersion: 2,
        snapshotType: 'full',
        snapshotId: 'mac-cleared',
        sourceInstanceId: 'monitor:mac',
        updatedAt: '2026-08-19T11:00:00.000Z',
        providers: [{
          provider: 'claude',
          accountKey: 'monitor:mac:conn-a',
          status: 'ok',
          updatedAt: '2026-08-19T11:00:00.000Z',
          windows: []
        }]
      }
    });
    hub.ingest({
      deviceId: 'pc',
      updatedAt: '2026-08-19T11:01:00.000Z',
      limits: {
        schemaVersion: 2,
        snapshotType: 'full',
        snapshotId: 'pc-cleared',
        sourceInstanceId: 'monitor:pc',
        updatedAt: '2026-08-19T11:01:00.000Z',
        providers: [{
          provider: 'claude',
          accountKey: 'monitor:pc:conn-b',
          status: 'ok',
          updatedAt: '2026-08-19T11:01:00.000Z',
          windows: []
        }]
      }
    });
    const afterDelete = hub.getStats().limits.quotaPools;
    assert.equal(afterDelete.length, 1);
    assert.equal(afterDelete[0].quotaPoolKey, 'pool-other');
  } finally {
    fs.rmSync(dataFile, { force: true });
  }
});

test('ingest without a deviceId throws', () => {
  const dataFile = tempDataFile();
  const hub = createHub({ port: 0, host: '127.0.0.1', secret: '', dataFile, logger: { error() {} } });
  try {
    assert.throws(() => hub.ingest({ today: { totalTokens: 1 } }), /deviceId/);
  } finally {
    fs.rmSync(dataFile, { force: true });
  }
});

test('onStats fires on ingest and on deleteDevice, and unsubscribe stops it', () => {
  const dataFile = tempDataFile();
  const hub = createHub({ port: 0, host: '127.0.0.1', secret: '', dataFile, logger: { error() {} } });
  try {
    let calls = 0;
    let lastDeviceCount = -1;
    const unsub = hub.onStats((stats) => { calls += 1; lastDeviceCount = stats.devices.length; });
    hub.ingest({ deviceId: 'dev-a', today: { totalTokens: 5 } });
    assert.equal(calls, 1);
    assert.equal(lastDeviceCount, 1);
    hub.deleteDevice('dev-a');
    assert.equal(calls, 2);
    assert.equal(lastDeviceCount, 0);
    unsub();
    hub.ingest({ deviceId: 'dev-b', today: { totalTokens: 1 } });
    assert.equal(calls, 2);
  } finally {
    fs.rmSync(dataFile, { force: true });
  }
});

test('oversized ingest returns 413 without storing the device', async () => {
  const dataFile = tempDataFile();
  const hub = createHub({ port: 0, host: '127.0.0.1', secret: '', dataFile, logger: { error() {} } });
  await hub.start();
  try {
    const { port } = hub.server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: 'oversized', padding: '🚀'.repeat(270_000) })
    });

    assert.equal(response.status, 413);
    assert.equal(response.headers.get('connection'), 'close');
    assert.deepEqual(await response.json(), {
      error: 'payload_too_large',
      message: 'Request body too large'
    });
    assert.equal(hub.getStats().devices.length, 0);
  } finally {
    await hub.stop();
    fs.rmSync(dataFile, { force: true });
  }
});

test('ingest accepts payloads above the legacy 256 KiB limit', async () => {
  const dataFile = tempDataFile();
  const hub = createHub({ port: 0, host: '127.0.0.1', secret: '', dataFile, logger: { error() {} } });
  await hub.start();
  try {
    const { port } = hub.server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: 'larger', padding: 'x'.repeat(300 * 1024) })
    });

    assert.equal(response.status, 200);
    assert.equal(hub.getStats().devices.length, 1);
  } finally {
    await hub.stop();
    fs.rmSync(dataFile, { force: true });
  }
});

test('GET /api/limits/snapshot returns 404 when the endpoint is disabled', async () => {
  const dataFile = tempDataFile();
  const hub = createHub({
    port: 0,
    host: '127.0.0.1',
    secret: 'test-secret',
    dataFile,
    limitsSnapshotEnabled: false,
    logger: { error() {} }
  });
  await hub.start();
  try {
    const { port } = hub.server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/limits/snapshot`, {
      headers: { authorization: 'Bearer test-secret' }
    });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'not_found' });
  } finally {
    await hub.stop();
    fs.rmSync(dataFile, { force: true });
  }
});

test('GET /api/limits/snapshot returns redacted limits when enabled', async () => {
  const dataFile = tempDataFile();
  const hub = createHub({
    port: 0,
    host: '127.0.0.1',
    secret: 'snap-secret',
    dataFile,
    limitsSnapshotEnabled: true,
    limitsSnapshotRateLimitMs: 0,
    logger: { error() {} }
  });
  const accountKey = 'sha256:abc123';
  hub.ingest({
    deviceId: 'widget',
    limits: {
      updatedAt: '2026-07-24T10:00:00.000Z',
      providers: [{
        provider: 'codex',
        accountKey,
        accountEmail: 'user@example.com',
        connectionKey: 'conn-1',
        status: 'ok',
        source: 'rpc',
        updatedAt: '2026-07-24T10:00:00.000Z',
        windows: [{ kind: 'weekly', usedPercent: 40, remainingPercent: 60 }]
      }]
    }
  });
  await hub.start();
  try {
    const { port } = hub.server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/limits/snapshot?version=1`, {
      headers: { authorization: 'Bearer snap-secret' }
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.schemaVersion, LIMITS_SNAPSHOT_SCHEMA_VERSION);
    assert.equal(body.negotiatedVersion, 1);
    assert.deepEqual(body.capabilities, ['limits']);
    assert.equal(body.limits.providers.length, 1);
    assert.equal(body.limits.providers[0].provider, 'codex');
    assert.equal(body.limits.providers[0].accountEmail, undefined);
    assert.equal(body.limits.providers[0].connectionKey, undefined);
    assert.equal(body.limits.providers[0].route, undefined);
    assert.equal(body.limits.providers[0].switch, undefined);
    assert.equal(body.limits.providers[0].action, undefined);
    assert.doesNotMatch(JSON.stringify(body), /"route"|"switch"|"action"/);
  } finally {
    await hub.stop();
    fs.rmSync(dataFile, { force: true });
  }
});

test('GET /api/limits/snapshot negotiates version and rejects unsupported versions', async () => {
  const dataFile = tempDataFile();
  const hub = createHub({
    port: 0,
    host: '127.0.0.1',
    secret: '',
    dataFile,
    limitsSnapshotEnabled: true,
    limitsSnapshotRateLimitMs: 0,
    logger: { error() {} }
  });
  await hub.start();
  try {
    const { port } = hub.server.address();
    const unsupported = await fetch(`http://127.0.0.1:${port}/api/limits/snapshot?version=99`);
    assert.equal(unsupported.status, 406);
    assert.deepEqual(await unsupported.json(), { error: 'unsupported_version', supported: [1] });

    const negotiated = await fetch(`http://127.0.0.1:${port}/api/limits/snapshot`, {
      headers: { accept: 'application/vnd.token-monitor.limits-snapshot.v1+json' }
    });
    assert.equal(negotiated.status, 200);
    assert.equal((await negotiated.json()).negotiatedVersion, 1);
  } finally {
    await hub.stop();
    fs.rmSync(dataFile, { force: true });
  }
});

test('GET /api/limits/snapshot rate limits rapid requests', async () => {
  const dataFile = tempDataFile();
  const hub = createHub({
    port: 0,
    host: '127.0.0.1',
    secret: '',
    dataFile,
    limitsSnapshotEnabled: true,
    limitsSnapshotRateLimitMs: 60_000,
    logger: { error() {} }
  });
  await hub.start();
  try {
    const { port } = hub.server.address();
    const url = `http://127.0.0.1:${port}/api/limits/snapshot`;
    const first = await fetch(url);
    const second = await fetch(url);
    assert.equal(first.status, 200);
    assert.equal(second.status, 429);
    const body = await second.json();
    assert.equal(body.error, 'rate_limited');
    assert.ok(Number.isFinite(body.retryAfterMs));
  } finally {
    await hub.stop();
    fs.rmSync(dataFile, { force: true });
  }
});

test('GET /api/limits/snapshot requires auth when a secret is configured', async () => {
  const dataFile = tempDataFile();
  const hub = createHub({
    port: 0,
    host: '127.0.0.1',
    secret: 'needs-auth',
    dataFile,
    limitsSnapshotEnabled: true,
    limitsSnapshotRateLimitMs: 0,
    logger: { error() {} }
  });
  await hub.start();
  try {
    const { port } = hub.server.address();
    const denied = await fetch(`http://127.0.0.1:${port}/api/limits/snapshot`);
    assert.equal(denied.status, 401);
    const allowed = await fetch(`http://127.0.0.1:${port}/api/limits/snapshot`, {
      headers: { authorization: 'Bearer needs-auth' }
    });
    assert.equal(allowed.status, 200);
  } finally {
    await hub.stop();
    fs.rmSync(dataFile, { force: true });
  }
});

test('buildHubLimitsSnapshot strips routing advice fields', () => {
  const snapshot = buildHubLimitsSnapshot({
    staleAfterMs: 600000,
    limits: {
      providers: [{
        provider: 'codex',
        status: 'ok',
        route: 'switch-model',
        action: 'pause',
        switch: 'gpt-5',
        windows: [{ kind: 'weekly', usedPercent: 10 }]
      }]
    }
  });
  assert.doesNotMatch(JSON.stringify(snapshot), /"route"|"switch"|"action"/);
});


test('Hub applies Potluck full snapshots, deletes missing connections, and persists ordering state', () => {
  const dataFile = tempDataFile();
  const row = (connectionKey, status = 'ok') => ({
    provider: 'zai',
    connectionKey,
    accountKey: connectionKey,
    managedBy: 'potluck',
    identityKind: 'connection',
    connectionStatus: status,
    quotaStatus: status === 'ok' ? 'fresh' : 'unauthorized',
    status,
    updatedAt: '2026-08-20T10:00:00.000Z',
    windows: status === 'ok' ? [{ kind: 'session', usedPercent: 20, remainingPercent: 80 }] : []
  });
  const snapshot = (snapshotId, generatedAt, providers) => ({
    schemaVersion: 2,
    snapshotType: 'full',
    snapshotId,
    sourceInstanceId: 'potluck:instance-a',
    generatedAt,
    providers
  });
  const hub = createHub({ port: 0, host: '127.0.0.1', secret: '', dataFile, logger: { error() {} } });
  try {
    hub.ingest({ deviceId: 'potluck', limits: snapshot('s1', '2026-08-20T10:00:00.000Z', [row('potluck:instance-a:a'), row('potluck:instance-a:b')]) });
    assert.equal(hub.getStats().limits.providers.filter((entry) => entry.managedBy === 'potluck').length, 2);

    hub.ingest({ deviceId: 'potluck', limits: snapshot('s2', '2026-08-20T10:05:00.000Z', [row('potluck:instance-a:a')]) });
    assert.deepEqual(
      hub.getStats().limits.providers.filter((entry) => entry.managedBy === 'potluck').map((entry) => entry.connectionKey),
      ['potluck:instance-a:a']
    );

    const reloaded = createHub({ port: 0, host: '127.0.0.1', secret: '', dataFile, logger: { error() {} } });
    reloaded.ingest({ deviceId: 'potluck', limits: snapshot('old', '2026-08-20T09:00:00.000Z', [row('potluck:instance-a:b')]) });
    assert.deepEqual(
      reloaded.getStats().limits.providers.filter((entry) => entry.managedBy === 'potluck').map((entry) => entry.connectionKey),
      ['potluck:instance-a:a']
    );
  } finally {
    fs.rmSync(dataFile, { force: true });
  }
});

test('Hub rejects a Potluck snapshot without source identity', () => {
  const dataFile = tempDataFile();
  const hub = createHub({ port: 0, host: '127.0.0.1', secret: '', dataFile, logger: { error() {} } });
  try {
    assert.throws(() => hub.ingest({
      deviceId: 'potluck',
      limits: {
        schemaVersion: 2,
        snapshotType: 'full',
        snapshotId: 'missing-source',
        generatedAt: '2026-08-20T10:00:00.000Z',
        providers: [{ provider: 'zai', connectionKey: 'conn-a', managedBy: 'potluck', windows: [] }]
      }
    }), /limits_snapshot_missing_identity/);
  } finally {
    fs.rmSync(dataFile, { force: true });
  }
});
