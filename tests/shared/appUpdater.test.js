'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  appUpdateInstallSupport,
  buildCustomInstallScript,
  deriveAppUpdateAvailability,
  downloadedAppUpdateMatchesLatest,
  extractReleaseNotes,
  mergeLatestReleaseMetadata,
  parseLatestReleasePayload,
  parseTag,
  selectMacZipAsset,
  shouldDownloadAutomaticAppUpdate,
  shouldSkipAppUpdateCheck
} = require('../../src/shared/appUpdater');

test('parseTag strips a leading v from valid semver tags', () => {
  assert.equal(parseTag('v1.2.3'), '1.2.3');
  assert.equal(parseTag('V0.1.0'), '0.1.0');
});

test('parseTag accepts tags without a v prefix', () => {
  assert.equal(parseTag('1.2.3'), '1.2.3');
});

test('parseTag returns null for invalid or empty input', () => {
  assert.equal(parseTag(''), null);
  assert.equal(parseTag(null), null);
  assert.equal(parseTag(undefined), null);
  assert.equal(parseTag('release-foo'), null);
  assert.equal(parseTag('v1.2'), null);
  assert.equal(parseTag(123), null);
});

test('appUpdateInstallSupport only enables packaged auto-updatable targets', () => {
  assert.deepEqual(appUpdateInstallSupport({ isPackaged: false, platform: 'darwin' }), { supported: false, reason: 'unpackaged' });
  assert.deepEqual(appUpdateInstallSupport({ isPackaged: true, platform: 'darwin' }), { supported: true, reason: '' });
  assert.deepEqual(appUpdateInstallSupport({ isPackaged: true, platform: 'win32', env: {} }), { supported: true, reason: '' });
  assert.deepEqual(appUpdateInstallSupport({
    isPackaged: true,
    platform: 'win32',
    env: { PORTABLE_EXECUTABLE_FILE: 'C:\\Downloads\\Token-Monitor.exe' }
  }), { supported: false, reason: 'windows-portable' });
  assert.deepEqual(appUpdateInstallSupport({ isPackaged: true, platform: 'linux', env: {} }), { supported: false, reason: 'linux-not-appimage' });
  assert.deepEqual(appUpdateInstallSupport({ isPackaged: true, platform: 'linux', env: { APPIMAGE: '/tmp/Token Monitor.AppImage' } }), { supported: true, reason: '' });
});

test('appUpdateInstallSupport reports the macOS install path from the signing probe', () => {
  assert.deepEqual(
    appUpdateInstallSupport({ isPackaged: true, platform: 'darwin', macSigned: true }),
    { supported: true, reason: 'macos-native' }
  );
  assert.deepEqual(
    appUpdateInstallSupport({ isPackaged: true, platform: 'darwin', macSigned: false }),
    { supported: true, reason: 'macos-custom' }
  );
  assert.deepEqual(
    appUpdateInstallSupport({ isPackaged: true, platform: 'darwin', macSigned: null }),
    { supported: true, reason: '' }
  );
  assert.deepEqual(
    appUpdateInstallSupport({ isPackaged: true, platform: 'win32', env: {}, macSigned: false }),
    { supported: true, reason: '' }
  );
});

test('shouldSkipAppUpdateCheck refreshes cached update prompts sooner than the normal cooldown', () => {
  const nowMs = Date.parse('2026-07-02T18:30:00Z');
  const twoHoursAgo = '2026-07-02T16:30:00Z';
  const tenMinutesAgo = '2026-07-02T18:20:00Z';
  const latest = { version: '0.18.0' };

  assert.equal(shouldSkipAppUpdateCheck({
    currentVersion: '0.17.0',
    latest,
    lastCheckedAt: twoHoursAgo,
    nowMs
  }), false);

  assert.equal(shouldSkipAppUpdateCheck({
    currentVersion: '0.17.0',
    latest,
    lastCheckedAt: tenMinutesAgo,
    nowMs
  }), true);
});

test('shouldSkipAppUpdateCheck uses normal cooldown for dismissed cached updates', () => {
  const nowMs = Date.parse('2026-07-02T18:30:00Z');
  const twoHoursAgo = '2026-07-02T16:30:00Z';

  assert.equal(shouldSkipAppUpdateCheck({
    currentVersion: '0.17.0',
    latest: { version: '0.18.0' },
    dismissedVersion: '0.18.0',
    lastCheckedAt: twoHoursAgo,
    nowMs
  }), true);
});

test('downloadedAppUpdateMatchesLatest only trusts the downloaded latest version', () => {
  assert.equal(downloadedAppUpdateMatchesLatest({
    phase: 'downloaded',
    downloadedVersion: '0.19.0',
    latest: { version: '0.19.0' }
  }), true);

  assert.equal(downloadedAppUpdateMatchesLatest({
    phase: 'downloaded',
    downloadedVersion: '0.18.0',
    latest: { version: '0.19.0' }
  }), false);

  assert.equal(downloadedAppUpdateMatchesLatest({
    phase: 'downloading',
    downloadedVersion: '0.19.0',
    latest: { version: '0.19.0' }
  }), false);

  assert.equal(downloadedAppUpdateMatchesLatest({
    phase: 'downloaded',
    downloadedVersion: '0.19.0',
    latest: null
  }), false);
});

test('shouldDownloadAutomaticAppUpdate covers the automatic-download state matrix', () => {
  const ready = {
    hasUpdate: true,
    installSupported: true,
    latest: { version: '0.28.1' },
    dismissedVersion: null,
    downloaded: false,
    installBusy: false
  };
  const cases = [
    ['enabled and ready', true, ready, true],
    ['preference disabled', false, ready, false],
    ['no update', true, { ...ready, hasUpdate: false }, false],
    ['unsupported build', true, { ...ready, installSupported: false }, false],
    ['latest version dismissed', true, { ...ready, dismissedVersion: '0.28.1' }, false],
    ['older version dismissed', true, { ...ready, dismissedVersion: '0.28.0' }, true],
    ['already downloaded', true, { ...ready, downloaded: true }, false],
    ['check or download already in flight', true, { ...ready, installBusy: true }, false],
    ['missing update state', true, null, false]
  ];

  for (const [name, automaticAppUpdates, updateState, expected] of cases) {
    assert.equal(
      shouldDownloadAutomaticAppUpdate({ automaticAppUpdates, updateState }),
      expected,
      name
    );
  }
});

test('deriveAppUpdateAvailability keeps availability separate from notification dismissal', () => {
  assert.deepEqual(deriveAppUpdateAvailability({
    currentVersion: '0.28.0',
    latest: { version: '0.28.1' },
    dismissedVersion: '0.28.1',
    phase: 'idle'
  }), {
    hasUpdate: true,
    dismissed: true,
    downloaded: false,
    showUpdateNotice: false
  });
});

test('deriveAppUpdateAvailability always surfaces a downloaded matching update', () => {
  assert.deepEqual(deriveAppUpdateAvailability({
    currentVersion: '0.28.0',
    latest: { version: '0.28.1' },
    dismissedVersion: '0.28.1',
    phase: 'downloaded',
    downloadedVersion: '0.28.1'
  }), {
    hasUpdate: true,
    dismissed: true,
    downloaded: true,
    showUpdateNotice: true
  });
});

test('extractReleaseNotes reads marked bilingual summaries as plain text', () => {
  const body = `
## What's changed
<!-- app-update-notes:en:start -->
### Added
- **Projects view:** Track usage by \`workspace\` with [setup notes](https://example.com).
### Fixed
- <strong>Updater:</strong> Keeps the action available.
<!-- app-update-notes:en:end -->

## 更新内容
<!-- app-update-notes:zh:start -->
### 新增
- **项目视图：** 按工作区追踪用量。
<!-- app-update-notes:zh:end -->
`;

  assert.deepEqual(extractReleaseNotes(body), {
    en: [
      { title: 'Added', items: ['Projects view: Track usage by workspace with setup notes.'] },
      { title: 'Fixed', items: ['Updater: Keeps the action available.'] }
    ],
    zh: [
      { title: '新增', items: ['项目视图：按工作区追踪用量。'] }
    ]
  });
});

test('extractReleaseNotes hides trailing PR references from App summaries', () => {
  const body = `
<!-- app-update-notes:en:start -->
### Added
- Projects view tracks workspace usage. (#122, #138, #144)
- Issue #150 remains visible when it is part of the sentence.
<!-- app-update-notes:en:end -->
<!-- app-update-notes:zh:start -->
### 新增
- 项目视图可按工作区追踪用量。（#122、#138、#144）
- 问题 #150 是句子内容的一部分，应该保留。
<!-- app-update-notes:zh:end -->
`;

  assert.deepEqual(extractReleaseNotes(body), {
    en: [{
      title: 'Added',
      items: [
        'Projects view tracks workspace usage.',
        'Issue #150 remains visible when it is part of the sentence.'
      ]
    }],
    zh: [{
      title: '新增',
      items: [
        '项目视图可按工作区追踪用量。',
        '问题 #150 是句子内容的一部分，应该保留。'
      ]
    }]
  });
});

test('extractReleaseNotes ignores unmarked release sections', () => {
  const body = `
## What's changed

### Improved
- Clearer update status.

## Download
- Installer

## 更新内容

### 改进
- 更新状态更清楚。

## 下载
- 安装包
`;

  assert.deepEqual(extractReleaseNotes(body), {});
});

test('extractReleaseNotes bounds groups, items, and item length', () => {
  const added = Array.from({ length: 5 }, (_, index) => (
    `- Added ${index + 1}${index === 0 ? ` ${'😀'.repeat(700)}` : ''}`
  )).join('\n');
  const notes = extractReleaseNotes(`
<!-- app-update-notes:en:start -->
### Added
${added}
### Changed
- Changed 1
- Changed 2
- Changed 3
### Improved
- Improved 1
- Improved 2
- Improved 3
### Fixed
- Fixed 1
- Fixed 2
- Fixed 3
### Extra
- Extra
<!-- app-update-notes:en:end -->
`);

  assert.deepEqual(notes.en.map((group) => group.title), ['Added', 'Changed', 'Improved', 'Fixed']);
  assert.deepEqual(notes.en.map((group) => group.items.length), [5, 3, 3, 1]);
  assert.equal(notes.en.reduce((total, group) => total + group.items.length, 0), 12);
  assert.equal(Array.from(notes.en[0].items[0]).length, 600);
  assert.match(notes.en[0].items[0], /…$/);
});

test('release template exposes marked English and Chinese app summaries', () => {
  const template = fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'RELEASE_TEMPLATE.md'), 'utf8');
  const notes = extractReleaseNotes(template);
  const categoryPairs = new Map([
    ['Added', '新增'],
    ['Changed', '变更'],
    ['Improved', '改进'],
    ['Fixed', '修复']
  ]);
  assert.ok(notes.en.length > 0);
  assert.deepEqual(
    notes.zh.map((group) => group.title),
    notes.en.map((group) => categoryPairs.get(group.title))
  );
  assert.ok(notes.en.every((group) => categoryPairs.has(group.title)));
  assert.ok(notes.en.every((group) => group.items.length > 0));
  assert.ok(notes.zh.every((group) => group.items.length > 0));
  assert.ok(notes.en.every((group) => group.items.every((item) => !/\(#\d/.test(item))));
  assert.ok(notes.zh.every((group) => group.items.every((item) => !/（#\d/.test(item))));
  assert.match(template, /\(#\d+(?:, #\d+)*\)/);
  assert.match(template, /（#\d+(?:、#\d+)*）/);
});

test('mergeLatestReleaseMetadata preserves notes when native updater metadata omits them', () => {
  const releaseNotes = { en: [{ title: 'Fixed', items: ['An updater fix.'] }] };
  assert.deepEqual(
    mergeLatestReleaseMetadata(
      { version: '0.28.0', name: 'GitHub release', releaseNotes },
      { version: '0.28.0', name: 'Native updater' }
    ),
    { version: '0.28.0', name: 'Native updater', releaseNotes }
  );
  assert.deepEqual(
    mergeLatestReleaseMetadata(
      { version: '0.28.0', releaseNotes },
      { version: '0.29.0', name: 'Next release' }
    ),
    { version: '0.29.0', name: 'Next release' }
  );
});

test('parseLatestReleasePayload returns normalized object for valid payload', () => {
  const result = parseLatestReleasePayload({
    tag_name: 'v0.1.3',
    name: 'Token Monitor 0.1.3',
    html_url: 'https://github.com/Javis603/token-monitor/releases/tag/v0.1.3',
    published_at: '2026-05-26T12:00:00Z',
    body: `
## What's changed
<!-- app-update-notes:en:start -->
### Added
- Release summaries in the app.
<!-- app-update-notes:en:end -->
## Download
`
  });
  assert.deepEqual(result, {
    version: '0.1.3',
    tag: 'v0.1.3',
    name: 'Token Monitor 0.1.3',
    htmlUrl: 'https://github.com/Javis603/token-monitor/releases/tag/v0.1.3',
    publishedAt: '2026-05-26T12:00:00Z',
    releaseNotes: {
      en: [{ title: 'Added', items: ['Release summaries in the app.'] }]
    }
  });
});

test('parseLatestReleasePayload falls back to tag when name is missing', () => {
  const result = parseLatestReleasePayload({
    tag_name: 'v0.1.3',
    html_url: 'https://github.com/Javis603/token-monitor/releases/tag/v0.1.3'
  });
  assert.equal(result.name, 'v0.1.3');
  assert.equal(result.publishedAt, '');
});

test('parseLatestReleasePayload returns null for invalid or missing tag', () => {
  assert.equal(parseLatestReleasePayload({}), null);
  assert.equal(parseLatestReleasePayload({ tag_name: 'release-foo' }), null);
  assert.equal(parseLatestReleasePayload({ tag_name: '' }), null);
  assert.equal(parseLatestReleasePayload(null), null);
  assert.equal(parseLatestReleasePayload('not an object'), null);
});

test('parseLatestReleasePayload rejects payloads without an https html_url', () => {
  assert.equal(parseLatestReleasePayload({
    tag_name: 'v0.1.3',
    html_url: 'http://example.com'
  }), null);
  assert.equal(parseLatestReleasePayload({
    tag_name: 'v0.1.3'
  }), null);
});

test('parseLatestReleasePayload carries the matching macOS zip asset', () => {
  const result = parseLatestReleasePayload({
    tag_name: 'v0.30.0',
    html_url: 'https://github.com/Ezero23/potluck-monitor/releases/tag/v0.30.0',
    assets: [
      { name: 'potluck-monitor-0.30.0-arm64.dmg', browser_download_url: 'https://example.com/app.dmg', size: 10 },
      { name: 'potluck-monitor-0.30.0-arm64.zip', browser_download_url: 'https://example.com/app.zip', size: 1234 }
    ]
  });
  assert.deepEqual(result.zipAsset, {
    name: 'potluck-monitor-0.30.0-arm64.zip',
    url: 'https://example.com/app.zip',
    size: 1234
  });
});

test('selectMacZipAsset picks the zip matching the requested arch', () => {
  const assets = [
    { name: 'potluck-monitor-0.30.0-arm64.dmg', browser_download_url: 'https://example.com/app-arm64.dmg', size: 10 },
    { name: 'potluck-monitor-0.30.0-arm64.zip', browser_download_url: 'https://example.com/app-arm64.zip', size: 100 },
    { name: 'potluck-monitor-0.30.0-x64.zip', browser_download_url: 'https://example.com/app-x64.zip', size: 200 }
  ];
  assert.deepEqual(selectMacZipAsset(assets, 'arm64'), {
    name: 'potluck-monitor-0.30.0-arm64.zip',
    url: 'https://example.com/app-arm64.zip',
    size: 100
  });
  assert.deepEqual(selectMacZipAsset(assets, 'x64'), {
    name: 'potluck-monitor-0.30.0-x64.zip',
    url: 'https://example.com/app-x64.zip',
    size: 200
  });
});

test('selectMacZipAsset returns null without a matching or usable asset', () => {
  assert.equal(selectMacZipAsset([
    { name: 'potluck-monitor-0.30.0-arm64.dmg', browser_download_url: 'https://example.com/app.dmg', size: 10 }
  ], 'arm64'), null);
  assert.equal(selectMacZipAsset([
    { name: 'potluck-monitor-0.30.0-arm64.zip', browser_download_url: 'http://example.com/app.zip', size: 10 }
  ], 'arm64'), null);
  assert.equal(selectMacZipAsset([
    { name: 'potluck-monitor-0.30.0-arm64.zip', size: 10 }
  ], 'arm64'), null);
  assert.equal(selectMacZipAsset(null, 'arm64'), null);
  assert.equal(selectMacZipAsset('not-an-array', 'arm64'), null);
  assert.equal(selectMacZipAsset([], 'arm64'), null);
});

test('selectMacZipAsset skips malformed entries and tolerates a missing size', () => {
  const assets = [
    null,
    { name: 42, browser_download_url: 'https://example.com/wrong.zip' },
    { name: 'other-app-0.30.0-arm64.zip', browser_download_url: 'https://example.com/other.zip' },
    { name: 'potluck-monitor-0.30.0-arm64.zip', browser_download_url: 'https://example.com/app.zip' }
  ];
  assert.deepEqual(selectMacZipAsset(assets, 'arm64'), {
    name: 'potluck-monitor-0.30.0-arm64.zip',
    url: 'https://example.com/app.zip',
    size: null
  });
});

test('buildCustomInstallScript waits, replaces, dequarantines, and relaunches', () => {
  const script = buildCustomInstallScript({
    pid: 1234,
    appPath: '/Applications/Potluck Monitor.app',
    zipPath: '/tmp/potluck-monitor-0.30.0-arm64.zip'
  });
  assert.match(script, /^#!/);
  assert.match(script, /PID=1234/);
  assert.match(script, /while kill -0 "\$PID" 2>\/dev\/null; do/);
  assert.match(script, /sleep 0\.3/);
  assert.match(script, /rm -rf "\$APP_PATH"/);
  assert.match(script, /ditto -x -k "\$ZIP_PATH" "\$\(dirname "\$APP_PATH"\)"/);
  assert.match(script, /xattr -dr com\.apple\.quarantine "\$APP_PATH" 2>\/dev\/null \|\| true/);
  assert.match(script, /open "\$APP_PATH"/);
  assert.match(script, /APP_PATH='\/Applications\/Potluck Monitor\.app'/);
  assert.match(script, /ZIP_PATH='\/tmp\/potluck-monitor-0\.30\.0-arm64\.zip'/);
});

test('buildCustomInstallScript escapes single quotes in interpolated paths', () => {
  const script = buildCustomInstallScript({
    pid: 42,
    appPath: "/Applications/O'Brien/Potluck Monitor.app",
    zipPath: "/tmp/it's here/update.zip"
  });
  assert.match(script, /APP_PATH='\/Applications\/O'\\''Brien\/Potluck Monitor\.app'/);
  assert.match(script, /ZIP_PATH='\/tmp\/it'\\''s here\/update\.zip'/);
});
