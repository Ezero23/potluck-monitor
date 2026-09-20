'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  codebuddyToken,
  isRefillPack,
  refillCadence,
  windowsFromAccounts,
  parseCodeBuddyBody,
  fetchCodeBuddyLimits
} = require('../../src/shared/codebuddyLimits');

const DAY = 86_400;

function pack({
  cycleStartDaysAgo = 10,
  cycleEndInDays = 20,
  deductionEndInDays = null,
  cycleUsed = 6.5,
  cycleSize = 500,
  used = 0,
  size = 0,
  name = 'CodeBuddy Pro'
} = {}) {
  const day = (offset) => Math.round((Date.now() / 1000) + offset * DAY);
  return {
    PackageName: name,
    CycleStartTime: day(-cycleStartDaysAgo),
    CycleEndTime: day(cycleEndInDays),
    DeductionEndTime: day(deductionEndInDays === null ? cycleEndInDays : deductionEndInDays),
    CycleCapacityUsed: cycleUsed,
    CycleCapacitySize: cycleSize,
    CycleCapacityUsedPrecise: String(cycleUsed),
    CycleCapacitySizePrecise: String(cycleSize),
    CapacityUsed: used,
    CapacitySize: size,
    CapacityUsedPrecise: String(used),
    CapacitySizePrecise: String(size)
  };
}

test('codebuddyToken reads settings before env and trims quotes', () => {
  assert.equal(codebuddyToken({ TOKEN_MONITOR_CODEBUDDY_TOKEN: 'env' }, { codebuddyToken: ' "settings" ' }), 'settings');
  assert.equal(codebuddyToken({ CODEBUDDY_TOKEN: ' env ' }), 'env');
  assert.equal(codebuddyToken({}), '');
});

test('isRefillPack separates recurring packs from one-shot bonus credits', () => {
  assert.equal(isRefillPack(pack({ cycleEndInDays: 20, deductionEndInDays: 320 })), true);
  assert.equal(isRefillPack(pack({ cycleEndInDays: 20, deductionEndInDays: 20 })), false);
  assert.equal(isRefillPack({ CycleEndTime: 'junk' }), false);
});

test('refillCadence labels the cycle length', () => {
  assert.equal(refillCadence(pack({ cycleStartDaysAgo: 1, cycleEndInDays: 0 })), 'Daily');
  assert.equal(refillCadence(pack({ cycleStartDaysAgo: 6, cycleEndInDays: 1 })), 'Weekly');
  assert.equal(refillCadence(pack({ cycleStartDaysAgo: 10, cycleEndInDays: 20 })), 'Monthly');
});

test('windowsFromAccounts splits refill and bonus packs with distinct labels', () => {
  const { windows, planLabel } = windowsFromAccounts([
    pack({ name: 'Basic Pack', cycleUsed: 6.54, cycleSize: 500, deductionEndInDays: 300 }),
    pack({ name: 'Bonus', cycleUsed: 3, cycleSize: 3, used: 12.5, size: 50, deductionEndInDays: 5 }),
    pack({ name: 'Second Monthly', cycleUsed: 1, cycleSize: 100, deductionEndInDays: 200 })
  ]);

  assert.equal(planLabel, 'Basic Pack');
  const monthly = windows.filter((window) => window.label.startsWith('Monthly'));
  assert.equal(monthly.length, 2);
  assert.deepEqual(monthly.map((window) => window.label), ['Monthly', 'Monthly 2']);
  assert.equal(monthly[0].used, 6.54);
  assert.equal(monthly[0].limit, 500);
  assert.equal(monthly[0].usedPercent, 1.308);
  assert.equal(monthly[0].resetPolicy, 'fixed');

  const bonus = windows.find((window) => window.label === 'Bonus Pack 1');
  assert.equal(bonus.used, 12.5);
  assert.equal(bonus.limit, 50);
  assert.equal(bonus.resetPolicy, undefined);
  assert.match(bonus.resetDescription, /One-shot/);
});

test('parseCodeBuddyBody unwraps the double-wrapped envelope', () => {
  const accounts = parseCodeBuddyBody({ code: 0, data: { Response: { Data: { Accounts: [pack()] } } } });
  assert.equal(accounts.length, 1);
  assert.throws(() => parseCodeBuddyBody({ code: 4001, msg: 'bad token' }), /bad token/);
  assert.throws(() => parseCodeBuddyBody(null), /unknown/);
});

test('fetchCodeBuddyLimits reports notConfigured without a token', async () => {
  const provider = await fetchCodeBuddyLimits({}, { env: {} });
  assert.equal(provider.provider, 'codebuddy');
  assert.equal(provider.status, 'notConfigured');
});

test('fetchCodeBuddyLimits posts with CLI headers and maps accounts', async () => {
  const calls = [];
  const provider = await fetchCodeBuddyLimits({}, {
    env: { TOKEN_MONITOR_CODEBUDDY_TOKEN: 'tok' },
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      assert.equal(init.method, 'POST');
      assert.equal(init.headers['x-codebuddy-request'], '1');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          code: 0,
          data: { Response: { Data: { Accounts: [pack({ cycleUsed: 100, cycleSize: 500, deductionEndInDays: 300 })] } } }
        })
      };
    }
  });

  assert.equal(provider.status, 'ok');
  assert.equal(provider.accountLabel, 'CodeBuddy Pro');
  assert.equal(provider.windows.length, 1);
  assert.equal(provider.windows[0].usedPercent, 20);
  assert.ok(calls[0].url.includes('copilot.tencent.com'));
});

test('fetchCodeBuddyLimits maps auth failures to unauthorized', async () => {
  const provider = await fetchCodeBuddyLimits({}, {
    env: { CODEBUDDY_TOKEN: 'bad' },
    fetch: async () => ({ ok: false, status: 401 })
  });
  assert.equal(provider.status, 'unauthorized');
});
