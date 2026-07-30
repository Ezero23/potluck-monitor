'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { applySessionTimestamps } = require('../../src/shared/collector');

test('applySessionTimestamps fills OpenCode session start/last from injected DB meta', () => {
  const periods = {
    today: {
      sessions: {
        'opencode:ses_abc': { client: 'opencode', sessionId: 'ses_abc', startedAt: '', lastUsedAt: '' }
      }
    }
  };
  const readOpencodeMeta = (ids) => {
    assert.ok(ids.has('ses_abc'));
    return new Map([['ses_abc', {
      startedAt: '2026-06-04T10:00:00.000Z',
      lastUsedAt: '2026-06-04T10:05:00.000Z',
      title: 'Greeting'
    }]]);
  };

  applySessionTimestamps(periods, '/no/such/home', { readOpencodeMeta });

  const s = periods.today.sessions['opencode:ses_abc'];
  assert.strictEqual(s.startedAt, '2026-06-04T10:00:00.000Z');
  assert.strictEqual(s.lastUsedAt, '2026-06-04T10:05:00.000Z');
});

test('applySessionTimestamps leaves non-opencode sessions to the file path (no DB reader call)', () => {
  const periods = {
    today: {
      sessions: {
        'claude:abc-123': { client: 'claude', sessionId: 'abc-123', startedAt: '', lastUsedAt: '' }
      }
    }
  };
  let called = false;
  const readOpencodeMeta = () => { called = true; return new Map(); };

  applySessionTimestamps(periods, '/no/such/home', { readOpencodeMeta });

  assert.strictEqual(called, false, 'opencode reader must not run when there are no opencode sessions');
});

test('applySessionTimestamps reuses resolved metadata across progressive periods', () => {
  const cache = { metadataCache: new Map(), resolvedSessionKeys: new Set(), attemptedSessionKeys: new Set() };
  const calls = [];
  const readOpencodeMeta = (ids) => {
    calls.push([...ids]);
    return new Map([...ids].map((id) => [id, { projectPath: `/work/${id}` }]));
  };
  const today = { sessions: {
    'opencode:s1': { client: 'opencode', sessionId: 's1' }
  } };
  const month = { sessions: {
    'opencode:s1': { client: 'opencode', sessionId: 's1' },
    'opencode:s2': { client: 'opencode', sessionId: 's2' }
  } };

  applySessionTimestamps({ today }, '/home/test', { ...cache, readOpencodeMeta });
  applySessionTimestamps({ today, month }, '/home/test', { ...cache, readOpencodeMeta });
  applySessionTimestamps({ today, month }, '/home/test', { ...cache, readOpencodeMeta });

  assert.deepEqual(calls, [['s1'], ['s2']]);
  assert.equal(month.sessions['opencode:s1'].projectLabel, 's1');
  assert.equal(month.sessions['opencode:s2'].projectLabel, 's2');
});

test('applySessionTimestamps does not re-read an unchanged session file on the next tick', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-tick-'));
  const realOpen = fs.openSync;
  try {
    const dir = path.join(home, '.claude', 'projects', '-work-app');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'sess-1.jsonl');
    fs.writeFileSync(file, `${JSON.stringify({ cwd: '/work/app', timestamp: '2026-07-13T10:00:00.000Z' })}\n`);

    let opens = 0;
    fs.openSync = (target, ...rest) => { if (target === file) opens += 1; return realOpen(target, ...rest); };

    // Each collector tick rebuilds the per-tick dedup caches, so persistence
    // must survive a fresh deps object — that is what a real interval tick sees.
    // applySessionTimestamps mutates the periods object in place.
    const tick = () => {
      const periods = { today: { sessions: { 'claude:sess-1': { client: 'claude', sessionId: 'sess-1' } } } };
      applySessionTimestamps(periods, home, {
        metadataCache: new Map(), resolvedSessionKeys: new Set(), attemptedSessionKeys: new Set()
      });
      return periods.today.sessions['claude:sess-1'];
    };

    tick(); // first tick warms the caches
    opens = 0;
    const unchanged = tick(); // second tick, file untouched
    assert.equal(opens, 0, 'an unchanged session file must not be re-read on the next tick');
    assert.equal(unchanged.projectLabel, 'app');
    assert.equal(unchanged.lastUsedAt, '2026-07-13T10:00:00.000Z');

    // A grown session (new size/mtime) must invalidate the cache and refresh lastUsedAt.
    fs.appendFileSync(file, `${JSON.stringify({ cwd: '/work/app', timestamp: '2026-07-13T11:30:00.000Z' })}\n`);
    opens = 0;
    const grown = tick();
    assert.ok(opens > 0, 'a changed session file must be re-read');
    assert.equal(grown.lastUsedAt, '2026-07-13T11:30:00.000Z');
  } finally {
    fs.openSync = realOpen;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('applySessionTimestamps retries a progressive miss in the final pass', () => {
  const cache = { metadataCache: new Map(), resolvedSessionKeys: new Set(), attemptedSessionKeys: new Set() };
  const periods = { today: { sessions: {
    'opencode:s1': { client: 'opencode', sessionId: 's1' }
  } } };
  let reads = 0;
  const readOpencodeMeta = () => {
    reads += 1;
    return reads === 1 ? new Map() : new Map([['s1', { projectPath: '/work/project' }]]);
  };

  applySessionTimestamps(periods, '/home/test', { ...cache, readOpencodeMeta });
  applySessionTimestamps(periods, '/home/test', { ...cache, readOpencodeMeta });
  assert.equal(reads, 1, 'intermediate periods should not repeat a known miss');
  assert.equal(periods.today.sessions['opencode:s1'].projectId, undefined);

  applySessionTimestamps(periods, '/home/test', { ...cache, readOpencodeMeta, retryMisses: true });
  assert.equal(reads, 2, 'the final pass should retry a prior miss once');
  assert.equal(periods.today.sessions['opencode:s1'].projectLabel, 'project');
});

test('applySessionTimestamps fills Kimi session start/last from state.json', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-kimi-'));
  try {
    const dir = path.join(home, '.kimi-code', 'sessions', 'wd_app_1234', 'session_abc-123');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({
      createdAt: '2026-07-30T09:00:00.000Z',
      updatedAt: '2026-07-30T11:30:00.000Z'
    }));

    const periods = { today: { sessions: {
      'kimi:session_abc-123': { client: 'kimi', sessionId: 'session_abc-123', startedAt: '', lastUsedAt: '' }
    } } };
    applySessionTimestamps(periods, home, {});

    const s = periods.today.sessions['kimi:session_abc-123'];
    assert.equal(s.startedAt, '2026-07-30T09:00:00.000Z');
    assert.equal(s.lastUsedAt, '2026-07-30T11:30:00.000Z');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('applySessionTimestamps fills WorkBuddy session timestamps from the JSONL tail', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-workbuddy-'));
  try {
    const dir = path.join(home, '.workbuddy', 'projects', 'Users-test');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'wb-1.jsonl');
    fs.writeFileSync(file, `${JSON.stringify({ cwd: '/work/app', timestamp: '2026-07-30T14:15:00.000Z' })}\n`);

    const periods = { today: { sessions: {
      'workbuddy:wb-1': { client: 'workbuddy', sessionId: 'wb-1', startedAt: '', lastUsedAt: '' }
    } } };
    applySessionTimestamps(periods, home, {});

    const s = periods.today.sessions['workbuddy:wb-1'];
    assert.equal(s.lastUsedAt, '2026-07-30T14:15:00.000Z');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
