'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  moveSettingsSectionOrder,
  normalizeSettingsSectionOrder,
  orderedSettingsSections,
  reorderSettingsSectionOrder
} = require('../../src/electron/renderer/settingsSectionPreferences');

const sections = ['general', 'main', 'window', 'appearance', 'tools', 'limits', 'accounts', 'sync', 'potluck'];

test('normalizeSettingsSectionOrder drops unknown ids, dedupes, and appends missing sections', () => {
  assert.deepEqual(
    normalizeSettingsSectionOrder('tools,unknown,tools,general', sections),
    ['tools', 'general', 'main', 'window', 'appearance', 'limits', 'accounts', 'sync', 'potluck']
  );
});

test('normalizeSettingsSectionOrder defaults to the given ids order and accepts arrays', () => {
  assert.deepEqual(normalizeSettingsSectionOrder('', sections), sections);
  assert.deepEqual(normalizeSettingsSectionOrder(undefined, sections), sections);
  assert.deepEqual(normalizeSettingsSectionOrder(['sync', 'general'], sections), [
    'sync', 'general', 'main', 'window', 'appearance', 'tools', 'limits', 'accounts', 'potluck'
  ]);
});

test('orderedSettingsSections returns the given entries in saved order', () => {
  assert.deepEqual(orderedSettingsSections(sections, 'sync,general'), [
    'sync', 'general', 'main', 'window', 'appearance', 'tools', 'limits', 'accounts', 'potluck'
  ]);
  assert.deepEqual(
    orderedSettingsSections([{ id: 'a' }, { id: 'b' }], 'b'),
    [{ id: 'b' }, { id: 'a' }]
  );
});

test('moveSettingsSectionOrder moves a section up and down within the full order', () => {
  assert.equal(
    moveSettingsSectionOrder('', sections, 'main', 'up'),
    'main,general,window,appearance,tools,limits,accounts,sync,potluck'
  );
  assert.equal(
    moveSettingsSectionOrder('', sections, 'general', 'up'),
    sections.join(',')
  );
});

test('reorderSettingsSectionOrder moves a section to an absolute position', () => {
  assert.equal(
    reorderSettingsSectionOrder('', sections, 'potluck', 0),
    'potluck,general,main,window,appearance,tools,limits,accounts,sync'
  );
  assert.equal(reorderSettingsSectionOrder('', sections, 'unknown', 0), sections.join(','));
});
