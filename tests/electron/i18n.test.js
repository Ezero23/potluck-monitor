'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  applyTranslations,
  LANGUAGE_OPTIONS,
  MESSAGES,
  normalizeLanguage,
  resolveLocale,
  translate
} = require('../../src/electron/renderer/i18n');

function fakeElement(dataset = {}) {
  const attributes = {};
  return {
    dataset,
    textContent: '',
    title: '',
    placeholder: '',
    attributes,
    setAttribute(name, value) {
      attributes[name] = value;
    },
    getAttribute(name) {
      return attributes[name];
    }
  };
}

test('normalizeLanguage keeps supported choices and falls back to auto', () => {
  assert.equal(normalizeLanguage('zh-tw'), 'zh-CN');
  assert.equal(normalizeLanguage('zh_cn'), 'zh-CN');
  assert.equal(normalizeLanguage('en'), 'en');
  assert.equal(normalizeLanguage('fr'), 'auto');
  assert.equal(normalizeLanguage(''), 'auto');
});

test('WSL SQLite recovery guidance is localized without English fallback', () => {
  for (const locale of LANGUAGE_OPTIONS.map((option) => option.value).filter((value) => value !== 'auto')) {
    assert.ok(MESSAGES[locale]['settings.collection.wslPanel.sqliteHelp'], locale);
    assert.ok(MESSAGES[locale]['settings.collection.wslPanel.setupGuide'], locale);
  }
});

test('resolveLocale maps auto to Chinese variants from browser languages', () => {
  assert.equal(resolveLocale('auto', ['zh-HK', 'en-US']), 'zh-CN');
  assert.equal(resolveLocale('auto', ['zh-Hans-CN', 'en-US']), 'zh-CN');
  assert.equal(resolveLocale('auto', ['en-US']), 'en');
  assert.equal(resolveLocale('zh-CN', ['zh-TW']), 'zh-CN');
});

test('translate falls back to English and interpolates values', () => {
  assert.equal(translate('zh-CN', 'settings.sync.title'), '多设备同步');
  assert.equal(translate('zh-CN', 'settings.codex.personalWorkspace'), '个人');
  assert.equal(translate('zh-CN', 'settings.appUpdate.latestWithStatus', { version: '0.2.1', status: '已是最新' }), 'v0.2.1（已是最新）');
  assert.equal(translate('zh-CN', 'missing.key'), 'missing.key');
});

test('automatic app update copy describes background downloads, not update checks', () => {
  assert.equal(translate('en', 'settings.appUpdate.automatic'), 'Download updates automatically');
  assert.equal(
    translate('en', 'settings.appUpdate.automaticDescription'),
    "Download new versions in the background. You'll be prompted to restart when ready."
  );
  assert.equal(translate('zh-CN', 'settings.appUpdate.automatic'), '自动下载更新');
  assert.equal(
    translate('zh-CN', 'settings.appUpdate.automaticUnsupportedWindowsPortable'),
    'Portable 版本不支持自动下载，请通过“查看 release”手动更新。'
  );
});

test('every bundled locale defines every English key', () => {
  const englishKeys = Object.keys(MESSAGES.en).sort();
  for (const locale of Object.keys(MESSAGES).filter((code) => code !== 'en')) {
    const missing = englishKeys.filter((key) => MESSAGES[locale][key] === undefined);
    assert.deepEqual(missing, [], `${locale} should not rely on English fallback`);
  }
});

test('every language option has a dictionary, normalizes to itself, and is reachable via auto-detect', () => {
  for (const { value } of LANGUAGE_OPTIONS) {
    assert.equal(normalizeLanguage(value), value, `${value} should normalize to itself`);
    if (value !== 'auto') {
      assert.ok(MESSAGES[value], `${value} should have a message dictionary`);
      assert.equal(resolveLocale('auto', [value]), value, `auto should resolve a ${value} system locale`);
    }
  }
});

test('tray limit labels describe remaining quota instead of ambiguous worst windows', () => {
  assert.equal(translate('zh-CN', 'settings.tray.barsSession'), '额度条：单次剩余最少');
  assert.equal(translate('zh-CN', 'settings.tray.barsAllSessions'), '额度条：前两个工具的主要额度');
  assert.equal(translate('zh-CN', 'settings.tray.limitsAllSessions'), '额度：前两个工具的主要额度（12% · 34%）');
  assert.equal(translate('zh-CN', 'settings.tray.barsWindow'), '额度条：任一额度剩余最少');
});

test('window shortcut labels stay concise in Chinese', () => {
  assert.equal(translate('zh-CN', 'settings.display.windowShortcut'), '快捷键');
  assert.equal(translate('zh-CN', 'settings.shortcut.record'), '录制');
  assert.equal(translate('zh-CN', 'settings.display.windowShortcutListening'), '按下快捷键，Esc 取消。');
  assert.equal(translate('zh-CN', 'settings.display.windowShortcutInvalid'), '请搭配 Ctrl、Cmd 或 Alt。');
  assert.equal(translate('zh-CN', 'settings.display.windowShortcutConflict', { shortcut: 'Cmd/Ctrl+Shift+M' }), '无法注册 Cmd/Ctrl+Shift+M，可能和其他 app 冲突。');
});

test('AI limit capability labels stay compact in Chinese', () => {
  assert.equal(translate('en', 'settings.limits.capability.appCliRpc'), 'App/CLI RPC');
  assert.equal(translate('zh-CN', 'settings.limits.capability.appMustBeOpen'), '需打开 App 或 CLI');
  assert.equal(translate('zh-CN', 'settings.limits.capability.appCliRpc'), 'App/CLI RPC');
  assert.equal(translate('zh-CN', 'settings.limits.capability.manualLogin'), '手动登录');
  assert.equal(translate('zh-CN', 'settings.limits.status.openApp'), '请打开 App 或 CLI');
  assert.equal(translate('zh-CN', 'settings.limits.status.linked'), '已连接');
  assert.equal(translate('zh-CN', 'settings.limits.device.local'), '本机');
  assert.equal(translate('zh-CN', 'settings.limits.device.from', { device: 'work-mac' }), '来自 work-mac');
  assert.equal(translate('zh-CN', 'settings.limits.device.localAndSynced', { count: 2 }), '本机 + 2 同步');
  assert.equal(translate('zh-CN', 'settings.limits.device.localAlso'), '本机也有');
  assert.equal(translate('zh-CN', 'settings.limits.capability.web'), 'Web');
  assert.equal(translate('zh-CN', 'settings.limits.capability.webApi'), 'Web/API');
  assert.equal(translate('zh-CN', 'settings.limits.capability.membershipCodingPlan'), '会员/Coding Plan');
  assert.equal(translate('zh-CN', 'settings.kimi.step3'), '找到 kimi-auth，复制它的 Value。');
  assert.equal(translate('zh-CN', 'settings.kimi.apiFallback'), '可选：Kimi Code API 备用');
  assert.equal(translate('zh-CN', 'settings.limits.status.noSyncedData'), '暂无同步数据');
});

test('applyTranslations updates text, title, aria-label, placeholders, and document lang', () => {
  const title = fakeElement({ i18n: 'settings.sync.title' });
  const button = fakeElement({ i18nTitle: 'settings.sync.copySecret' });
  const dismiss = fakeElement({ i18nAriaLabel: 'settings.appUpdate.dismiss' });
  const input = fakeElement({ i18nPlaceholder: 'settings.sync.secretPlaceholder' });
  const paste = fakeElement({ i18nTitle: 'settings.sync.pasteSecret', i18nAriaLabel: 'settings.sync.pasteSecret' });
  const langOption = fakeElement({ i18n: 'settings.language.zhCN' });
  const documentElement = fakeElement();
  const root = {
    documentElement,
    querySelectorAll(selector) {
      if (selector === '[data-i18n]') return [title, langOption];
      if (selector === '[data-i18n-title]') return [button, paste];
      if (selector === '[data-i18n-aria-label]') return [dismiss, paste];
      if (selector === '[data-i18n-placeholder]') return [input];
      return [];
    }
  };

  applyTranslations(root, 'zh-CN');

  assert.equal(title.textContent, '多设备同步');
  assert.equal(button.title, '复制密钥');
  assert.equal(paste.title, '粘贴密钥');
  assert.equal(paste.getAttribute('aria-label'), '粘贴密钥');
  assert.equal(dismiss.getAttribute('aria-label'), '忽略此版本');
  assert.equal(input.placeholder, '选填的共享密钥');
  assert.equal(langOption.textContent, '简体中文');
  assert.equal(documentElement.getAttribute('lang'), 'zh-CN');
});

test('service status provider preference labels exist in Chinese', () => {
  assert.equal(translate('zh-CN', 'serviceStatus.providersNote'), '选择 Status 页显示哪些服务、以及顺序。');
  assert.equal(translate('zh-CN', 'serviceStatus.allHidden'), '已隐藏所有服务');
  assert.equal(translate('zh-CN', 'serviceStatus.configureProviders', { name: '状态' }), '设置 状态 服务');
});

test('the affected-component count is localized', () => {
  assert.equal(translate('en', 'serviceStatus.components', { count: 4 }), 'Affected: 4');
  assert.equal(translate('zh-CN', 'serviceStatus.components', { count: 4 }), '受影响组件：4');
});

test('relative status timestamps are localized', () => {
  assert.equal(translate('zh-CN', 'serviceStatus.agoSeconds', { n: 5 }), '5 秒前');
  assert.equal(translate('zh-CN', 'serviceStatus.agoMinutes', { n: 3 }), '3 分钟前');
});

test('status refresh interval labels exist in Chinese', () => {
  assert.equal(translate('zh-CN', 'serviceStatus.refreshEvery'), '检查间隔');
  assert.equal(translate('zh-CN', 'serviceStatus.refreshManual'), '手动');
  assert.equal(translate('zh-CN', 'serviceStatus.refreshMinutes', { n: 5 }), '5 分钟');
});

test('view switcher actions are localized', () => {
  assert.equal(translate('en', 'views.switcher.next', { view: 'Models' }), 'Next: Models');
  assert.equal(translate('zh-CN', 'views.switcher.next', { view: '模型' }), '下一个：模型');
  assert.equal(translate('zh-CN', 'views.switcher.choose'), '选择视图');
  assert.equal(translate('en', 'views.backHome'), 'Back to Home');
  assert.equal(translate('zh-CN', 'views.backHome'), '返回主页');
});
