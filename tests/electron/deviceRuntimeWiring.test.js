'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { runManualDeviceRefresh } = require('../../src/electron/deviceRuntimeCoordinator');

const ROOT = path.resolve(__dirname, '../..');
const main = fs.readFileSync(path.join(ROOT, 'src/electron/main.js'), 'utf8');

test('every Electron collector mode retains local quota history', () => {
  assert.match(main, /require\('\.\.\/shared\/quotaHistory'\)/);
  assert.match(main, /retainQuotaHistoryFromLimits\(/);
  assert.equal((main.match(/retainDeviceQuotaHistory\(/g) || []).length, 4);
  assert.match(main, /writeEnabled:\s*\(\) => !isExternalAgentActive\(\)/);
});

test('clearing retained session usage also clears quota history', () => {
  assert.match(main, /clearSessionUsageArchive\(\);\s*clearDailyHistoryArchive\(\);\s*clearQuotaHistory\(\);/);
});


function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

for (const mode of ['local', 'client', 'host']) {
  test(`${mode} manual refresh awaits usage but never waits for limits`, async () => {
    const usage = deferred();
    const limits = deferred();
    const calls = [];
    const runtime = {
      refreshLimits(scope, reason) {
        calls.push(['limits', scope, reason]);
        return limits.promise;
      },
      tick(reason, options) {
        calls.push(['usage', reason, options]);
        return usage.promise;
      }
    };

    let completed = false;
    const refresh = runManualDeviceRefresh(runtime, { forceHistory: true }).then(() => { completed = true; });
    await Promise.resolve();
    assert.deepEqual(calls, [
      ['limits', { all: true }, 'manual'],
      ['usage', 'manual', { forceHistory: true }]
    ]);
    usage.resolve();
    await refresh;
    assert.equal(completed, true);
    limits.resolve();
  });
}

test('manual refresh reports a late limits failure without rejecting completed usage', async () => {
  const errors = [];
  const runtime = {
    refreshLimits: async () => { throw new Error('quota offline'); },
    tick: async () => {}
  };
  await runManualDeviceRefresh(runtime, { onLimitsError: (error) => errors.push(error.message) });
  await Promise.resolve();
  assert.deepEqual(errors, ['quota offline']);
});

test('manual refresh forwards a sanitized Connection scope to the limits runtime', async () => {
  const calls = [];
  const runtime = {
    refreshLimits: async (scope, reason) => { calls.push([scope, reason]); },
    tick: async () => {}
  };
  await runManualDeviceRefresh(runtime, {
    limitScope: {
      provider: ' MiMo ',
      accountKey: 'mimo-account-1',
      accountEmail: 'ignored@example.com',
      unsafe: 'ignored'
    }
  });
  assert.deepEqual(calls, [[{ provider: 'mimo', accountKey: 'mimo-account-1', accountEmail: 'ignored@example.com' }, 'manual']]);
});

test('manual refresh falls back to all providers without a scope', async () => {
  const calls = [];
  const runtime = {
    refreshLimits: async (scope, reason) => { calls.push([scope, reason]); },
    tick: async () => {}
  };
  await runManualDeviceRefresh(runtime);
  assert.deepEqual(calls, [[{ all: true }, 'manual']]);
});
