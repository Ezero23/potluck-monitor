'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8');
}

test('rotation controls do not navigate away through the quota card click handler', () => {
  const vm = require('node:vm');
  const source = read('src/electron/renderer/app.js');
  const shell = source.slice(source.indexOf('function homeModuleShell('));
  const handler = shell.match(/module\.addEventListener\('click', (\(event\) => \{[\s\S]*?\n {2}\})\);/)[1];
  let navigations = 0;
  const click = vm.runInNewContext(`(${handler})`, { viewId: 'limits', renderBreakdownChange: () => { navigations++; } });
  for (const selector of ['.home-rotation', '.home-activity-scroll']) {
    click({ target: { closest: (selectors) => selectors.split(', ').includes(selector) } });
  }
  assert.equal(navigations, 0);
  click({ target: { closest: () => null } });
  assert.equal(navigations, 1);
});

test('rotation headline stays compact while details are available on demand', () => {
  const source = read('src/electron/renderer/app.js');
  const { translate } = require('../../src/electron/renderer/i18n');
  assert.match(source, /function homeRotationLine\(style = 'compact'\)/);
  assert.match(source, /line\.title = homeRotationLine\('detail'\)/);
  assert.equal(translate('zh-CN', 'home.rotation.compact', { current: 'Codex', time: '15:15' }), '建议用 Codex · 15:15 复查');
});

test('Home low-limit indicators are opt-in and persist through the settings boundary', () => {
  const main = read('src/electron/main.js');
  const app = read('src/electron/renderer/app.js');

  assert.match(main, /showHomeLimitBars:\s*false/);
  assert.match(main, /merged\.showHomeLimitBars = parseBoolean\(merged\.showHomeLimitBars, false\)/);
  assert.match(main, /showHomeLimitBars:\s*parseBoolean\(patch\.showHomeLimitBars \?\? settings\.showHomeLimitBars, false\)/);
  assert.match(app, /statusInput\.checked = state\.settings\?\.showHomeLimitBars === true/);
  assert.match(app, /saveSettings\(\{ showHomeLimitBars: statusInput\.checked \}\)/);
});

test('Home highlights only low and critical remaining limits', () => {
  const app = read('src/electron/renderer/app.js');
  const css = read('src/electron/renderer/styles.css');

  assert.match(app, /function limitMeterNode\(color, percent, tone = 1, remainingPercent = null, usedPercent = null, showUsed = false\)/);
  assert.match(app, /const meter = limitMeterNode\(color, fillPercent, tone, meterRemaining, meterUsed, showUsed\)/);
  assert.match(app, /state\.settings\?\.showHomeLimitBars === true && window\.remainingPercent != null/);
  assert.match(app, /remainingPercent < 20/);
  assert.match(app, /value\.classList\.add\('home-limit-value-critical'\)/);
  assert.match(app, /remainingPercent < 50/);
  assert.match(app, /value\.classList\.add\('home-limit-value-low'\)/);
  assert.match(app, /line\.append\(label, value\)/);
  assert.doesNotMatch(app, /'home-limit-meter'/);
  assert.match(css, /\.home-limit-value-low\s*\{[^}]*--home-limit-accent/s);
  assert.match(css, /\.home-limit-value-critical\s*\{[^}]*color:\s*var\(--red\)/s);
  assert.doesNotMatch(css, /\.home-limit-value-critical\s*\{[^}]*display:\s*inline-flex/s);
  assert.match(css, /\.home-limit-value-critical::before\s*\{[^}]*width:\s*4px;[^}]*height:\s*4px;/s);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.limit-meter-fill,[\s\S]*?\.tab-indicator\s*\{[^}]*transition:\s*none;/);
});

test('Home low-limit indicator setting is translated in every locale', () => {
  const { MESSAGES } = require('../../src/electron/renderer/i18n');
  for (const [locale, messages] of Object.entries(MESSAGES)) {
    assert.ok(messages['settings.home.showLimitBars'], `${locale} should translate the Home limit bar setting`);
  }
});

test('Home multi-account rows always carry the provider name', () => {
  const main = read('src/electron/main.js');
  const app = read('src/electron/renderer/app.js');

  assert.match(app, /providerEntries\.length > 1/);
  assert.match(app, /limitAccountTitle\(id, provider, index, providerEntries\)/);
  assert.match(app, /`\$\{providerTitle\} · \$\{accountTitle\}`/);
  // No opt-out: provider identity must never rest on a 16px mask icon alone.
  assert.doesNotMatch(app, /showHomeLimitProviderNames|providerNamesRequiredWithoutIcons/);
  assert.doesNotMatch(main, /showHomeLimitProviderNames/);
});

test('Indistinguishable multi-account rows are disambiguated by source device', () => {
  const app = read('src/electron/renderer/app.js');

  assert.match(app, /String\(provider\?\.sourceDeviceId \|\| ''\)\.trim\(\)/);
  assert.match(app, /state\?\.stats\?\.devices/);
  assert.match(app, /replace\(\/\\s\*·\\s\*#\[a-f0-9\]\{6,\}\$\/i/);
});

test('Kimi and GLM monthly windows use a clear monthly label on the limits page', () => {
  const app = read('src/electron/renderer/app.js');

  assert.match(app, /monthly\.label \|\| 'Monthly'/);
  assert.match(app, /mcp\.label \|\| 'Monthly'/);
});

test('Home prefers real monthly windows and does not invent unavailable monthly coverage', () => {
  const app = read('src/electron/renderer/app.js');
  const overview = read('src/electron/renderer/homeOverview.js');

  assert.match(overview, /function selectHomeLimitWindows/);
  assert.doesNotMatch(overview, /REQUIRED_MONTHLY_PROVIDER_IDS/);
  assert.doesNotMatch(app, /homeOverviewApi\.withRequiredCoverage/);
  assert.match(app, /window\?\.showMeter === false && window\?\.detail === 'unavailable'/);
  assert.match(app, /return t\('settings\.common\.unavailable'\)/);
});

test('Tool icons toggle re-renders Home and persists appearance', () => {
  const app = read('src/electron/renderer/app.js');
  assert.match(app, /els\.toolIconsInput\.addEventListener\('change', async \(\) => \{\s*state\.settings\.showToolIcons = els\.toolIconsInput\.checked;\s*renderHomeIfVisible\(\);\s*await saveAppearanceFromControls\(\);\s*\}\);/);
});

test('Home account display count defaults to three and is configurable', () => {
  const main = read('src/electron/main.js');
  const app = read('src/electron/renderer/app.js');
  const html = read('src/electron/renderer/index.html');

  assert.match(main, /HOME_LIMIT_ACCOUNT_COUNT_DEFAULT = 50/);
  assert.match(main, /homeLimitAccountCount: HOME_LIMIT_ACCOUNT_COUNT_DEFAULT/);
  assert.match(main, /merged\.homeLimitAccountCount = normalizeHomeLimitAccountCount\(merged\.homeLimitAccountCount\)/);
  assert.match(main, /homeLimitAccountCount: normalizeHomeLimitAccountCount\(patch\.homeLimitAccountCount \?\? settings\.homeLimitAccountCount\)/);
  assert.match(app, /limit: state\.settings\?\.homeLimitAccountCount \?\? 50/);
  const renderSettings = app.slice(app.indexOf('function renderHomeLimitProviderList'), app.indexOf('function renderHomeSettingsList'));
  assert.match(renderSettings, /countInput\.type = 'number'/);
  assert.match(renderSettings, /countInput\.min = '1'/);
  assert.match(renderSettings, /countInput\.max = '50'/);
  assert.match(renderSettings, /saveSettings\(\{ homeLimitAccountCount: Number\(countInput\.value\) \}\)/);
  assert.doesNotMatch(html, /homeLimitAccountCountInput|settings\.limits\.homeAccountCount/);
});

test('Home account display count setting is translated in every locale', () => {
  const { MESSAGES } = require('../../src/electron/renderer/i18n');
  for (const [locale, messages] of Object.entries(MESSAGES)) {
    assert.ok(messages['settings.home.limitAccountCount'], `${locale} should translate the Home account count setting`);
    assert.ok(messages['settings.limits.enableAll'], `${locale} should translate the enable-all provider action`);
  }
});
