'use strict';

// Renderer HTML escaping: model ids, client ids, provider ids and error
// strings flow from tokscale scans and synced hub devices before they reach
// innerHTML templates, so every interpolation of data-derived text must go
// through escapeHtml. The function is pure and dual-exported (window global
// for the classic script-tag renderer, CommonJS for node:test).
(function exposeHtmlEscape(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TokenMonitorHtmlEscape = api;
})(typeof window !== 'undefined' ? window : null, function createHtmlEscapeApi() {
  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  return { escapeHtml };
});
