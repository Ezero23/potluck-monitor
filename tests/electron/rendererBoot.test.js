'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const rendererDir = path.join(__dirname, '../../src/electron/renderer');
const read = (name) => fs.readFileSync(path.join(rendererDir, name), 'utf8');

test('Home is visible with a Starting placeholder before app.js paints', () => {
  const html = read('index.html');
  assert.match(html, /<section id="homePanel" class="home-panel">/);
  assert.match(html, /<div class="home-empty-title">Starting<\/div>/);
  assert.doesNotMatch(html, /id="homePanel" class="home-panel hidden"/);
});

test('renderer boot script loads before quota modules and paints version without Node module', () => {
  const html = read('index.html');
  const bootIdx = html.indexOf('src="rendererBoot.js"');
  const forecastIdx = html.indexOf('src="../../shared/quotaForecast.js"');
  const appIdx = html.indexOf('src="app.js"');
  assert.ok(bootIdx > 0 && bootIdx < forecastIdx && forecastIdx < appIdx);

  const sandbox = {
    window: {
      tokenMonitor: {
        getAppInfo: async () => ({ version: '0.2.2' })
      }
    },
    document: {
      documentElement: { dataset: {} },
      getElementById: () => null,
      createElement: () => ({ className: '', textContent: '', append() {} })
    },
    addEventListener() {},
    console
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(read('rendererBoot.js'), sandbox);
  assert.equal(typeof sandbox.TokenMonitorRendererBoot.showHomeMessage, 'function');
});

test('init paints stats before hub, tokscale, and app-update IPC', () => {
  const app = read('app.js');
  const start = app.indexOf('async function init()');
  const end = app.indexOf('\nfor (const tab of document.querySelectorAll(\'.tab\'))', start);
  const body = app.slice(start, end);
  const statsIdx = body.indexOf('await refreshStats()');
  const hubIdx = body.indexOf('await refreshHubInfo()');
  const tokIdx = body.indexOf('await refreshTokscaleStatus()');
  const updateIdx = body.indexOf('getAppUpdateState()');
  assert.ok(statsIdx >= 0 && hubIdx >= 0 && tokIdx >= 0 && updateIdx >= 0);
  assert.ok(statsIdx < hubIdx, 'refreshStats must run before refreshHubInfo');
  assert.ok(statsIdx < tokIdx, 'refreshStats must run before refreshTokscaleStatus');
  assert.ok(statsIdx < updateIdx, 'refreshStats must run before getAppUpdateState');
  assert.match(body, /First paint must not wait on settings, hub, tokscale, or app-update IPC/);
});

test('refreshStats still paints Home when getStats throws', () => {
  const app = read('app.js');
  const start = app.indexOf('async function refreshStats');
  const end = app.indexOf('\nasync function refreshStatusViewManually', start);
  const body = app.slice(start, end);
  assert.match(body, /if \(!state\.stats\) state\.stats = \{ periods: \{\} \}/);
  assert.match(body, /try \{ render\(\); \} catch \(renderError\)/);
});

test('boot setup failures do not skip init', () => {
  const app = read('app.js');
  assert.match(app, /\[boot:setupCustomPricingUI\]/);
  assert.match(app, /\[boot:setupCursorAccountUI\]/);
  const customIdx = app.indexOf('[boot:setupCustomPricingUI]');
  const initIdx = app.lastIndexOf('init().catch');
  assert.ok(customIdx > 0 && customIdx < initIdx);
});
