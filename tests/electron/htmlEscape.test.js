'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { escapeHtml } = require('../../src/electron/renderer/htmlEscape');

test('escapeHtml neutralizes markup and attribute-breakout payloads', () => {
  assert.equal(escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(escapeHtml('" onmouseover="alert(1)'), '&quot; onmouseover=&quot;alert(1)');
  assert.equal(escapeHtml("a'&<>/"), 'a&#39;&amp;&lt;&gt;/');
});

test('escapeHtml tolerates non-string input without throwing', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(42), '42');
  assert.equal(escapeHtml('plain-model-id'), 'plain-model-id');
});
