'use strict';

// Runs before app.js. If a later classic script throws, Home used to stay
// `hidden` at the HTML "0" defaults. Surface the error and the installed
// version so a blank widget is diagnosable without DevTools.
(function exposeRendererBoot(root) {
  const doc = root.document;
  if (!doc) return;

  function setText(id, value) {
    const el = doc.getElementById(id);
    if (el) el.textContent = value;
  }

  function showHomeMessage(title, body) {
    const home = doc.getElementById('homePanel');
    if (!home) return;
    home.classList.remove('hidden');
    home.replaceChildren();
    const box = doc.createElement('div');
    box.className = 'home-empty';
    const heading = doc.createElement('div');
    heading.className = 'home-empty-title';
    heading.textContent = title;
    const detail = doc.createElement('div');
    detail.className = 'home-empty-body';
    detail.textContent = body;
    box.append(heading, detail);
    home.append(box);
  }

  function messageFromError(error) {
    if (!error) return 'unknown';
    if (typeof error === 'string') return error;
    return String(error.stack || error.message || error);
  }

  root.addEventListener('error', (event) => {
    const message = messageFromError(event.error || event.message).split('\n')[0];
    setText('status', 'Error');
    showHomeMessage('Renderer error', message);
  }, true);
  root.addEventListener('unhandledrejection', (event) => {
    const message = messageFromError(event.reason).split('\n')[0];
    setText('status', 'Error');
    showHomeMessage('Renderer error', message);
  });

  const tokenMonitor = root.tokenMonitor;
  if (tokenMonitor && typeof tokenMonitor.getAppInfo === 'function') {
    tokenMonitor.getAppInfo().then((info) => {
      if (!info || !info.version) return;
      doc.documentElement.dataset.appVersion = info.version;
      setText('aboutVersion', `v${info.version}`);
      const status = doc.getElementById('status');
      if (status && status.textContent === 'Starting') status.textContent = `v${info.version}`;
    }).catch(() => {});
  }

  root.TokenMonitorRendererBoot = { showHomeMessage };
})(typeof window !== 'undefined' ? window : globalThis);
