'use strict';

(function exposeLimitDisplayMode(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TokenMonitorLimitDisplayMode = api;
})(typeof window !== 'undefined' ? window : null, function createLimitDisplayModeApi() {
  // The percent to fill a limit meter with (and to render as the percent
  // number). In "left" mode this is the remaining quota (the bar empties as
  // quota is consumed); in "used" mode it is the consumed quota (the bar fills
  // as quota is consumed).
  //
  // Both modes anchor on remainingPercent: normalized limit windows always
  // expose it as the renderer-facing display field (providers that report
  // usedPercent instead have remainingPercent derived as the complement).
  // Keying off the single field every metered window carries keeps all
  // surfaces — limits list, home card, tray bars — in exact agreement no
  // matter which of them can see usedPercent; usedPercent is only a fallback
  // for the never-produced remaining-absent window.
  function limitFillPercent(remainingPercent, usedPercent, showUsed) {
    const remaining = Number(remainingPercent);
    const used = Number(usedPercent);
    if (showUsed) {
      if (Number.isFinite(remaining)) return 100 - remaining;
      if (Number.isFinite(used)) return used;
      return 0;
    }
    if (Number.isFinite(remaining)) return remaining;
    if (Number.isFinite(used)) return 100 - used;
    return 0;
  }

  // Trailing word for a percent limit label.
  function limitModeSuffix(showUsed) {
    return showUsed ? 'used' : 'left';
  }

  // Pick a semantic meter color based on how much quota is remaining.
  // Thresholds are applied to remaining percent regardless of used/left mode.
  function meterColorForRemaining(remainingPercent, baseColor) {
    const remaining = Number(remainingPercent);
    if (!Number.isFinite(remaining)) return baseColor;
    if (remaining > 80) return '#73bdf5';
    if (remaining > 60) return '#22d3ee';
    if (remaining > 40) return '#22c55e';
    if (remaining > 20) return '#facc15';
    return '#ef4444';
  }

  // Pick a semantic meter color based on how much quota has been used.
  // This mirrors the remaining scale but keyed off consumed percent: low
  // consumption stays cool, high consumption turns warm/red.
  function meterColorForUsed(usedPercent, baseColor) {
    const used = Number(usedPercent);
    if (!Number.isFinite(used)) return baseColor;
    if (used < 20) return '#73bdf5';
    if (used < 40) return '#22d3ee';
    if (used < 50) return '#22c55e';
    if (used < 60) return '#facc15';
    if (used < 80) return '#f59e0b';
    if (used >= 100) return '#a855f7';   // fully consumed: purple
    return '#ef4444';                       // 80-99%: red
  }

  return { limitFillPercent, limitModeSuffix, meterColorForRemaining, meterColorForUsed };
});
