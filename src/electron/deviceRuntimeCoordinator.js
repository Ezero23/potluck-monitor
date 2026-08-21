'use strict';

function normalizeLimitRefreshScope(scope) {
  if (!scope || typeof scope !== 'object') return { all: true };
  const provider = String(scope.provider || '').trim().toLowerCase();
  if (!provider) return { all: true };
  const allowed = ['accountKey', 'accountEmail', 'accountName', 'accountLabel', 'id'];
  const identity = {};
  for (const key of allowed) {
    const value = String(scope[key] || '').trim();
    if (value && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value)) identity[key] = value;
  }
  return { provider, ...identity };
}

async function runManualDeviceRefresh(runtime, options = {}) {
  if (!runtime) return;
  const limitsTask = Promise.resolve(runtime.refreshLimits(
    normalizeLimitRefreshScope(options.limitScope),
    'manual'
  ));
  limitsTask.catch((error) => options.onLimitsError?.(error));
  await runtime.tick('manual', { forceHistory: options.forceHistory === true });
}

module.exports = {
  runManualDeviceRefresh
};
