'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { openaiCompatibleBaseUrl } = require('../../src/shared/openaiCompatibleBaseUrl');

test('openaiCompatibleBaseUrl appends /v1 only when the stored URL lacks it', () => {
  assert.equal(openaiCompatibleBaseUrl(''), '');
  assert.equal(openaiCompatibleBaseUrl('https://es.potluck.top'), 'https://es.potluck.top/v1');
  assert.equal(openaiCompatibleBaseUrl('https://es.potluck.top/'), 'https://es.potluck.top/v1');
  assert.equal(openaiCompatibleBaseUrl('https://es.potluck.top/v1'), 'https://es.potluck.top/v1');
  assert.equal(openaiCompatibleBaseUrl('https://es.potluck.top/v1/'), 'https://es.potluck.top/v1');
  assert.equal(openaiCompatibleBaseUrl('http://localhost:21023'), 'http://localhost:21023/v1');
  assert.equal(openaiCompatibleBaseUrl('http://localhost:21023/v1'), 'http://localhost:21023/v1');
  assert.equal(openaiCompatibleBaseUrl('  https://es.potluck.top  '), 'https://es.potluck.top/v1');
});
