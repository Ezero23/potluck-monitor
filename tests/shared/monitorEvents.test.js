'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeMonitorEnvelope,
  normalizeMonitorEvent,
  mergeMonitorEnvelopes
} = require('../../src/shared/monitorEvents');

test('normalizes monitor events and removes unsafe detail', () => {
  const event = normalizeMonitorEvent({
    id: 'evt-1',
    type: 'routing_attempt',
    status: 'error',
    reason: 'https://provider.invalid/token=secret',
    candidates: [{ provider: 'claude', model: 'sonnet', status: 'skipped', reason: 'quota exhausted' }]
  });

  assert.deepEqual(event, {
    schemaVersion: 1,
    id: 'evt-1',
    type: 'routing_attempt',
    occurredAt: event.occurredAt,
    status: 'error',
    candidates: [{ provider: 'claude', model: 'sonnet', status: 'skipped', reason: 'quota exhausted' }]
  });
  assert.doesNotMatch(JSON.stringify(event), /https:\/\/|token=|secret/i);
});

test('merges envelopes by event id and keeps the newest bounded history', () => {
  const first = normalizeMonitorEnvelope({
    generatedAt: '2026-08-22T00:00:00.000Z',
    events: [{ id: 'evt-1', type: 'health_event', status: 'stale', occurredAt: '2026-08-22T00:00:00.000Z' }]
  });
  const second = normalizeMonitorEnvelope({
    generatedAt: '2026-08-22T00:01:00.000Z',
    health: { connections: 2, healthyConnections: 1 },
    events: [
      { id: 'evt-1', type: 'health_event', status: 'fresh', occurredAt: '2026-08-22T00:01:00.000Z' },
      { id: 'evt-2', type: 'routing_attempt', status: 'success', occurredAt: '2026-08-22T00:01:01.000Z' }
    ]
  });
  const merged = mergeMonitorEnvelopes(first, second);

  assert.equal(merged.health.connections, 2);
  assert.deepEqual(merged.events.map((event) => event.id), ['evt-1', 'evt-2']);
  assert.equal(merged.events[0].status, 'fresh');
});

test('drops envelopes that contain no safe monitor fields', () => {
  assert.equal(normalizeMonitorEnvelope({ events: [{ id: 'bad', type: 'unknown' }], token: 'secret' }), null);
});

const { aggregateDevices } = require('../../src/shared/usage');

test('aggregateDevices projects monitor envelope to renderer stats', () => {
  const stats = aggregateDevices([{
    deviceId: 'potluck',
    updatedAt: '2026-08-22T00:00:00.000Z',
    receivedAt: new Date().toISOString(),
    monitor: {
      generatedAt: new Date().toISOString(),
      health: { connections: 1, healthyConnections: 1 },
      events: [{ id: 'evt-1', type: 'routing_attempt', status: 'success' }]
    }
  }], 10 * 60 * 1000);

  assert.equal(stats.devices[0].monitor.health.connections, 1);
  assert.equal(stats.devices[0].monitor.events[0].id, 'evt-1');
});

const fixture = require('../fixtures/monitor-event-v1.json');

test('accepts the cross-repository v1 fixture', () => {
  const envelope = normalizeMonitorEnvelope(fixture.monitor);
  assert.equal(envelope.schemaVersion, 1);
  assert.equal(envelope.health.connections, 3);
  assert.equal(envelope.events[0].selectedProvider, 'anthropic');
  assert.equal(envelope.capabilities[0].transports[0], 'anthropic-messages');
});
