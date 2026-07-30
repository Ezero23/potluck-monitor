'use strict';

(function exposeSettingsSectionPreferences(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TokenMonitorSettingsSectionPreferences = api;
})(typeof window !== 'undefined' ? window : null, function createSettingsSectionPreferencesApi() {
  function entryId(entry) {
    return String(typeof entry === 'string' ? entry : entry?.id || '').trim().toLowerCase();
  }

  function normalizeSettingsSectionOrder(value, ids) {
    const known = (ids || []).map(entryId).filter(Boolean);
    const knownSet = new Set(known);
    const raw = Array.isArray(value) ? value : String(value || '').split(',');
    const seen = new Set();
    const order = [];
    for (const item of raw) {
      const id = String(item || '').trim().toLowerCase();
      if (!knownSet.has(id) || seen.has(id)) continue;
      seen.add(id);
      order.push(id);
    }
    for (const id of known) {
      if (seen.has(id)) continue;
      seen.add(id);
      order.push(id);
    }
    return order;
  }

  function orderedSettingsSections(ids, value) {
    const byId = new Map((ids || []).map((entry) => [entryId(entry), entry]).filter(([id]) => id));
    return normalizeSettingsSectionOrder(value, ids).map((id) => byId.get(id)).filter(Boolean);
  }

  function moveSettingsSectionOrder(value, ids, sectionId, direction) {
    const order = normalizeSettingsSectionOrder(value, ids);
    const from = order.indexOf(String(sectionId || '').trim().toLowerCase());
    const offset = direction === 'up' ? -1 : direction === 'down' ? 1 : 0;
    const to = from + offset;
    if (from < 0 || offset === 0 || to < 0 || to >= order.length) return order.join(',');
    const [item] = order.splice(from, 1);
    order.splice(to, 0, item);
    return order.join(',');
  }

  function reorderSettingsSectionOrder(value, ids, sectionId, targetIndex) {
    const order = normalizeSettingsSectionOrder(value, ids);
    const from = order.indexOf(String(sectionId || '').trim().toLowerCase());
    if (from < 0) return order.join(',');
    const to = Math.max(0, Math.min(order.length - 1, Number(targetIndex) || 0));
    if (from === to) return order.join(',');
    const [item] = order.splice(from, 1);
    order.splice(to, 0, item);
    return order.join(',');
  }

  return {
    moveSettingsSectionOrder,
    normalizeSettingsSectionOrder,
    orderedSettingsSections,
    reorderSettingsSectionOrder
  };
});
