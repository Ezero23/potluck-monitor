'use strict';

(function exposeOpenaiCompatibleBaseUrl(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TokenMonitorOpenaiCompatibleBaseUrl = api;
})(typeof window !== 'undefined' ? window : globalThis, function createOpenaiCompatibleBaseUrl() {
  function openaiCompatibleBaseUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const stripped = raw.replace(/\/+$/u, '');
    return /\/v1$/iu.test(stripped) ? stripped : `${stripped}/v1`;
  }

  return { openaiCompatibleBaseUrl };
});
