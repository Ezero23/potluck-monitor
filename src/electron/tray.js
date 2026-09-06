'use strict';

const path = require('node:path');
const {
  formatTrayText,
  isBarsTrayIconMode,
  isGeneratedTrayIconMode,
  pickUsageProviderId,
  pickWorstLimit
} = require('../shared/trayText');
const { codexAccountDisplayLabel } = require('./renderer/accountIdentity');
const { translate: translateMessage } = require('./renderer/i18n');

const ICON_PATH = path.join(__dirname, '..', '..', 'assets', 'icon.png');
const TRAY_ICON_PATH = path.join(__dirname, '..', '..', 'assets', 'icons', 'tray-token-monitor.png');
// macOS uses this value as NSStatusItem's autosave identity. Keep these UUIDs
// stable forever: changing them creates another entry in System Settings and
// can make the status item lose its saved menu-bar position after an update.
const PRODUCTION_TRAY_GUID = 'c498f4de-90f8-4dbf-aec2-047d789da062';
const DEVELOPMENT_TRAY_GUID = 'b30731e4-b4c7-4c29-8928-7924412bed87';

function trayGuidForBuild(isPackaged, platform = process.platform) {
  // An unsigned/ad-hoc-signed macOS build has no stable TeamIdentifier for
  // AppKit to associate with a GUID. Supplying one creates a separate Control
  // Center identity that macOS may place in its hidden menu-bar section. Let
  // AppKit use the bundle identity on macOS; keep stable UUIDs elsewhere.
  if (platform === 'darwin') return undefined;
  return isPackaged ? PRODUCTION_TRAY_GUID : DEVELOPMENT_TRAY_GUID;
}

function buildTrayIcon(options = {}) {
  const platform = options.platform || process.platform;
  const nativeImage = options.nativeImage || require('electron').nativeImage;
  if (platform === 'darwin') {
    // Menu-bar icons must be template images on macOS. The source artwork is a
    // transparent monochrome mask; template mode lets AppKit tint that mask for
    // the active menu-bar appearance instead of leaving its white strokes nearly
    // invisible on a light menu bar.
    const icon = nativeImage.createFromPath(TRAY_ICON_PATH).resize({ height: 20, quality: 'best' });
    icon.setTemplateImage(true);
    return icon;
  }
  return nativeImage.createFromPath(ICON_PATH).resize({ width: 20, height: 20 });
}

function trayUsagePeriod(contentMode) {
  if (contentMode === 'tokensAll' || contentMode === 'costAll' || contentMode === 'bothAll') return 'allTime';
  if (contentMode === 'tokens' || contentMode === 'cost' || contentMode === 'both') return 'today';
  return null;
}

function pickUsageTrayIconId(stats, contentMode = 'tokens', availableIconIds = []) {
  const periodKey = trayUsagePeriod(contentMode);
  if (!periodKey) return null;
  const metric = contentMode === 'cost' || contentMode === 'costAll' ? 'cost' : 'tokens';
  return pickUsageProviderId(stats, metric, periodKey, availableIconIds);
}

function sortCodexAccountsForDisplay(accounts) {
  const label = (account) => String(
    account?.email
    || account?.accountName
    || account?.accountLabel
    || account?.accountKey
    || account?.id
    || ''
  );
  return [...(accounts || [])].sort((left, right) => label(left).localeCompare(label(right)));
}

function reconcileCodexAccountSelection({ detectedAccountId, detectedAt, pendingAccountId, pendingSince } = {}) {
  const detected = String(detectedAccountId || '').trim();
  const pending = String(pendingAccountId || '').trim();
  if (!pending) return { activeAccountId: detected, pendingAccountId: '' };
  const detectedTime = typeof detectedAt === 'number' ? detectedAt : Date.parse(detectedAt || '');
  if (!detected || !Number.isFinite(detectedTime) || detectedTime < Number(pendingSince || 0)) {
    return { activeAccountId: pending, pendingAccountId: pending };
  }
  return { activeAccountId: detected, pendingAccountId: '' };
}

const TRAY_CONTENT_MENU_ITEMS = [
  ['tokens', 'trayMenu.content.todayTokens'],
  ['cost', 'trayMenu.content.todayCost'],
  ['both', 'trayMenu.content.todayBoth'],
  ['tokensAll', 'trayMenu.content.totalTokens'],
  ['costAll', 'trayMenu.content.totalCost'],
  ['bothAll', 'trayMenu.content.totalBoth'],
  ['limitsAllSessions', 'trayMenu.content.aiToolLimits'],
  ['barsSession', 'trayMenu.content.sessionLimitBar'],
  ['barsWeekly', 'trayMenu.content.weeklyLimitBar'],
  ['barsAllSessions', 'trayMenu.content.allToolsLimitBars'],
  ['bars', 'trayMenu.content.lowestRemainingLimitBar'],
  ['icon', 'trayMenu.content.appIconOnly'],
  ['custom', 'trayMenu.content.custom']
];

const WINDOW_PRESENTATION_MENU_ITEMS = [
  ['tray', 'trayMenu.presentation.tray'],
  ['floating', 'trayMenu.presentation.floating'],
  ['normal', 'trayMenu.presentation.normal'],
  ['desktop', 'trayMenu.presentation.desktop']
];

const OPEN_VIEW_MENU_ITEMS = [
  ['home', 'views.home'],
  ['project', 'views.project'],
  ['session', 'views.session'],
  ['limits', 'views.limits'],
  ['trends', 'views.trends'],
  ['status', 'views.status']
];

function buildTrayMenuTemplate(options = {}) {
  const state = options.state || {};
  const presentation = state.trayMode ? 'tray' : state.windowBehavior;
  const callback = (name) => (typeof options[name] === 'function' ? options[name] : () => {});
  const t = (key, params) => {
    const translated = typeof options.translate === 'function' ? options.translate(key, params) : '';
    return translated && translated !== key ? translated : translateMessage('en', key, params);
  };
  const codexAccounts = Array.isArray(state.codexAccounts) ? state.codexAccounts : [];
  const codexItem = codexAccounts.length >= 2 ? (() => {
    const labelFor = (account, index) => {
      return codexAccountDisplayLabel(account, codexAccounts, {
        maskEmail: state.maskAccountEmails,
        personalWorkspaceLabel: t('settings.codex.personalWorkspace')
      }) || t('trayMenu.codexAccountFallback', { number: index + 1 });
    };
    const activeIndex = codexAccounts.findIndex((account) => account.id === state.activeCodexAccountId);
    const label = activeIndex >= 0
      ? t('trayMenu.codexAccountCurrent', { account: labelFor(codexAccounts[activeIndex], activeIndex) })
      : t('trayMenu.codexAccount');
    return {
      label,
      submenu: codexAccounts.map((account, index) => ({
        label: labelFor(account, index),
        type: 'radio',
        checked: account.id === state.activeCodexAccountId,
        enabled: !state.codexSwitching,
        click: () => {
          if (account.id !== state.activeCodexAccountId) callback('onSwitchCodexAccount')(account.id);
        }
      }))
    };
  })() : null;
  return [
    {
      label: t(state.refreshing ? 'trayMenu.refreshing' : 'trayMenu.refreshNow'),
      enabled: !state.refreshing,
      click: callback('onRefresh')
    },
    {
      label: t('trayMenu.openView'),
      submenu: OPEN_VIEW_MENU_ITEMS.map(([value, labelKey]) => ({
        label: t(labelKey),
        enabled: state.viewEnabled?.[value] !== false,
        click: () => callback('onOpenView')(value)
      }))
    },
    ...(codexItem ? [codexItem] : []),
    { type: 'separator' },
    {
      label: t('trayMenu.trayDisplay'),
      submenu: TRAY_CONTENT_MENU_ITEMS.map(([value, labelKey]) => ({
        label: t(labelKey),
        type: 'radio',
        checked: state.trayContent === value,
        click: () => callback('onSetTrayContent')(value)
      }))
    },
    {
      label: t('trayMenu.windowPresentation'),
      submenu: WINDOW_PRESENTATION_MENU_ITEMS.map(([value, labelKey]) => ({
        label: t(labelKey),
        type: 'radio',
        checked: presentation === value,
        click: () => callback('onSetWindowPresentation')(value)
      }))
    },
    { type: 'separator' },
    { label: t('trayMenu.version', { version: state.appVersion || '' }), enabled: false },
    { label: t('trayMenu.settings'), click: callback('onOpenSettings') },
    { label: t('trayMenu.quit'), click: callback('onQuit') }
  ];
}

function createTray({
  guid,
  getMenuState,
  onOpenSettings,
  onOpenView,
  onQuit,
  onRefresh,
  onSetTrayContent,
  onSetWindowPresentation,
  onSwitchCodexAccount,
  onToggle,
  translateMenu
}) {
  const { Tray, Menu } = require('electron');
  const trayIcon = buildTrayIcon();
  const tray = guid ? new Tray(trayIcon, guid) : new Tray(trayIcon);
  tray.setToolTip('Token Monitor');

  tray.on('click', () => onToggle(tray));
  tray.showContextMenuAt = (anchor) => {
    const menu = Menu.buildFromTemplate(buildTrayMenuTemplate({
      state: typeof getMenuState === 'function' ? getMenuState() : {},
      onOpenSettings,
      onOpenView,
      onQuit,
      onRefresh,
      onSetTrayContent,
      onSetWindowPresentation,
      onSwitchCodexAccount,
      translate: translateMenu
    }));
    // Menu.popup defaults to the actual cursor. Explicit coordinates may be
    // interpreted relative to the focused window rather than the status bar.
    if (anchor) menu.popup();
    else tray.popUpContextMenu(menu);
  };
  tray.on('right-click', () => tray.showContextMenuAt());

  return tray;
}

function popoverBounds(tray, popoverWidth, popoverHeight) {
  const { screen } = require('electron');
  const trayBounds = tray?.getBounds?.() || { x: 0, y: 0, width: 0, height: 0 };
  const cursor = screen.getCursorScreenPoint();
  const anchor = trayBounds.width > 0
    ? { x: trayBounds.x + trayBounds.width / 2, y: trayBounds.y, height: trayBounds.height }
    : { x: cursor.x, y: cursor.y, height: 0 };
  const display = screen.getDisplayNearestPoint({ x: anchor.x, y: anchor.y });
  const wa = display.workArea;

  let x = Math.round(anchor.x - popoverWidth / 2);
  x = Math.max(wa.x + 4, Math.min(x, wa.x + wa.width - popoverWidth - 4));

  let y;
  if (process.platform === 'darwin') {
    y = Math.round(anchor.y + (anchor.height || 0) + 4);
  } else {
    // Windows / Linux: tray icon usually sits near the bottom; open above.
    y = Math.round(anchor.y - popoverHeight - 8);
    if (y < wa.y + 4) y = Math.round(anchor.y + (anchor.height || 0) + 8);
  }
  y = Math.max(wa.y + 4, Math.min(y, wa.y + wa.height - popoverHeight - 4));

  return { x, y, width: popoverWidth, height: popoverHeight };
}

module.exports = {
  DEVELOPMENT_TRAY_GUID,
  PRODUCTION_TRAY_GUID,
  buildTrayIcon,
  buildTrayMenuTemplate,
  createTray,
  formatTrayText,
  isBarsTrayIconMode,
  isGeneratedTrayIconMode,
  pickUsageTrayIconId,
  pickWorstLimit,
  popoverBounds,
  reconcileCodexAccountSelection,
  sortCodexAccountsForDisplay,
  trayGuidForBuild
};
