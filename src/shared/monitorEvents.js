'use strict';

const EVENT_SCHEMA_VERSION = 1;
const EVENT_TYPES = new Set(['quota_attempt', 'health_event', 'routing_attempt']);
const EVENT_STATUSES = new Set(['success', 'error', 'skipped', 'selected', 'fresh', 'stale', 'unsupported', 'unauthorized', 'rateLimited', 'unavailable']);
const MAX_EVENTS_PER_PUSH = 64;
const MAX_EVENT_HISTORY = 128;
const MAX_CANDIDATES = 64;
const MAX_CAPABILITIES = 256;

function text(value, max = 160) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function safeKey(value, max = 160) {
  const raw = text(value, max);
  if (!raw || raw.includes('://') || /bearer|token|secret|cookie|authorization|api[_-]?key/i.test(raw)) return '';
  return raw.replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, max);
}

function safeReason(value) {
  const raw = text(value, 192);
  if (!raw || /https?:\/\/|bearer\s|api[_-]?key|access[_-]?token|refresh[_-]?token|cookie|secret/i.test(raw)) return '';
  return raw;
}

function isoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function normalizeStatus(value) {
  const raw = text(value, 32);
  return EVENT_STATUSES.has(raw) ? raw : '';
}

function normalizeCandidate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = {
    provider: safeKey(value.provider, 64),
    model: safeKey(value.model, 128),
    status: normalizeStatus(value.status) || 'skipped'
  };
  const reason = safeReason(value.reason);
  const reasonCode = safeKey(value.reasonCode, 64);
  if (reason) candidate.reason = reason;
  if (reasonCode) candidate.reasonCode = reasonCode;
  if (Number.isFinite(Number(value.httpStatus))) candidate.httpStatus = Number(value.httpStatus);
  if (Number.isFinite(Number(value.latencyMs))) candidate.latencyMs = Math.max(0, Math.round(Number(value.latencyMs)));
  return candidate.provider || candidate.model ? candidate : null;
}

function normalizeMonitorEvent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const type = text(value.type, 32);
  if (!EVENT_TYPES.has(type)) return null;
  const event = {
    schemaVersion: EVENT_SCHEMA_VERSION,
    id: safeKey(value.id, 128),
    type,
    occurredAt: isoOrNull(value.occurredAt || value.timestamp) || new Date().toISOString()
  };
  if (!event.id) return null;
  for (const key of ['requestId', 'attemptId', 'profile', 'provider', 'model', 'connectionKey', 'selectedProvider', 'selectedModel', 'reasonCode']) {
    const normalized = safeKey(value[key], key === 'requestId' ? 128 : 160);
    if (normalized) event[key] = normalized;
  }
  const status = normalizeStatus(value.status);
  if (status) event.status = status;
  const reason = safeReason(value.reason || value.safeDetail);
  if (reason) event.reason = reason;
  const retryAt = isoOrNull(value.retryAt);
  if (retryAt) event.retryAt = retryAt;
  if (Number.isFinite(Number(value.latencyMs))) event.latencyMs = Math.max(0, Math.round(Number(value.latencyMs)));
  if (Number.isFinite(Number(value.httpStatus))) event.httpStatus = Number(value.httpStatus);
  if (Number.isFinite(Number(value.fallbackCount))) event.fallbackCount = Math.max(0, Math.min(64, Math.round(Number(value.fallbackCount))));
  if (value.final === true) event.final = true;
  if (Array.isArray(value.candidates)) {
    const candidates = value.candidates.map(normalizeCandidate).filter(Boolean).slice(0, MAX_CANDIDATES);
    if (candidates.length > 0) event.candidates = candidates;
  }
  return event;
}

function normalizeHealth(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const health = {
    schemaVersion: EVENT_SCHEMA_VERSION,
    generatedAt: isoOrNull(value.generatedAt) || new Date().toISOString(),
    providers: Math.max(0, Math.min(256, Math.round(Number(value.providers) || 0))),
    connections: Math.max(0, Math.min(256, Math.round(Number(value.connections) || 0))),
    healthyConnections: Math.max(0, Math.min(256, Math.round(Number(value.healthyConnections) || 0))),
    staleConnections: Math.max(0, Math.min(256, Math.round(Number(value.staleConnections) || 0))),
    unauthorizedConnections: Math.max(0, Math.min(256, Math.round(Number(value.unauthorizedConnections) || 0))),
    rateLimitedConnections: Math.max(0, Math.min(256, Math.round(Number(value.rateLimitedConnections) || 0))),
    unavailableConnections: Math.max(0, Math.min(256, Math.round(Number(value.unavailableConnections) || 0)))
  };
  const statusCounts = {};
  for (const [key, count] of Object.entries(value.statusCounts || {})) {
    const status = safeKey(key, 32);
    if (!status) continue;
    statusCounts[status] = Math.max(0, Math.min(256, Math.round(Number(count) || 0)));
  }
  health.statusCounts = statusCounts;
  return health;
}

function normalizeCapabilities(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_CAPABILITIES).map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const provider = safeKey(entry.provider, 64);
    if (!provider) return null;
    return {
      provider,
      streaming: entry.streaming !== false,
      tools: entry.tools !== false,
      vision: entry.vision === true,
      reasoning: entry.reasoning === true,
      quota: entry.quota === true,
      authTypes: Array.isArray(entry.authTypes) ? entry.authTypes.map((item) => safeKey(item, 32)).filter(Boolean).slice(0, 8) : [],
      transports: Array.isArray(entry.transports) ? entry.transports.map((item) => safeKey(item, 64)).filter(Boolean).slice(0, 8) : []
    };
  }).filter(Boolean);
}

function normalizeMonitorEnvelope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const health = normalizeHealth(value.health);
  const events = Array.isArray(value.events)
    ? value.events.map(normalizeMonitorEvent).filter(Boolean).slice(0, MAX_EVENTS_PER_PUSH)
    : [];
  const capabilities = normalizeCapabilities(value.capabilities);
  if (!health && events.length === 0 && capabilities.length === 0) return null;
  return {
    schemaVersion: EVENT_SCHEMA_VERSION,
    generatedAt: isoOrNull(value.generatedAt) || new Date().toISOString(),
    ...(health ? { health } : {}),
    ...(capabilities.length > 0 ? { capabilities } : {}),
    ...(events.length > 0 ? { events } : {})
  };
}

function mergeMonitorEnvelopes(previous, incoming) {
  const next = normalizeMonitorEnvelope(incoming) || normalizeMonitorEnvelope(previous);
  if (!next) return null;
  const prior = normalizeMonitorEnvelope(previous);
  const byId = new Map();
  for (const event of prior?.events || []) byId.set(event.id, event);
  for (const event of next.events || []) byId.set(event.id, event);
  const events = [...byId.values()]
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))
    .slice(-MAX_EVENT_HISTORY);
  return {
    ...(prior || {}),
    ...next,
    ...(events.length > 0 ? { events } : {})
  };
}

module.exports = {
  EVENT_SCHEMA_VERSION,
  normalizeMonitorEnvelope,
  normalizeMonitorEvent,
  mergeMonitorEnvelopes
};
