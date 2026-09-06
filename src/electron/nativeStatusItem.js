'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');

const HELPER_FILENAME = 'potluck-status-item';

function trayBoundsAreVisible(bounds, displays = []) {
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return false;
  return displays.some((display) => {
    const area = display?.bounds;
    const workArea = display?.workArea;
    if (!area || !workArea) return false;
    const right = bounds.x + bounds.width;
    const withinHorizontal = bounds.x >= area.x && right <= area.x + area.width;
    // Electron can inset an off-screen AppKit status window by one point:
    // AX (1883,-1,38,24) becomes (1884,0,36,22) on a 1920-wide screen.
    const parkedAtTopRight = bounds.y <= area.y && right >= area.x + area.width;
    const menuBarBottom = Math.max(area.y, workArea.y) + 6;
    return withinHorizontal && !parkedAtTopRight && bounds.y >= area.y && bounds.y < menuBarBottom;
  });
}

function parseHelperEvent(line) {
  const parts = String(line || '').trim().split('\t');
  if (!['toggle', 'menu'].includes(parts[0])) return { type: parts[0] || 'unknown' };
  const values = parts.slice(1, 5).map(Number);
  const anchor = parts.length === 5 && parts.slice(1).every((value) => value.trim() !== '')
    && values.every(Number.isFinite) && values[2] > 0 && values[3] > 0
    ? { x: values[0], y: values[1], width: values[2], height: values[3] }
    : null;
  return { type: parts[0], anchor };
}

function helperPath(resourcesPath = process.resourcesPath) {
  return path.join(
    resourcesPath || '',
    'Potluck Monitor Status Item.app',
    'Contents',
    'MacOS',
    HELPER_FILENAME
  );
}

function createNativeStatusItemBridge(options = {}) {
  let active = null;
  let pendingTitle = '';
  let pendingDisplay = null;
  let retryAt = 0;
  let failures = 0;

  const reportError = (run, error) => {
    if (!error || run.stopping || active !== run || error.code === 'EPIPE') return;
    options.onError?.(error);
  };

  const finish = (run, code, signal) => {
    if (run.finished) return;
    run.finished = true;
    clearTimeout(run.readyTimer);
    clearTimeout(run.killTimer);
    run.lines?.close();
    if (active !== run) return;
    active = null;
    if (run.stopping) return;
    failures += 1;
    retryAt = Date.now() + Math.min(30000, 1000 * (2 ** Math.min(failures - 1, 5)));
    if (code && !signal) options.onError?.(new Error(`native status item exited with code ${code}`));
    options.onExit?.({ code, signal });
  };

  const terminate = (run) => {
    if (run.terminating) return;
    run.terminating = true;
    clearTimeout(run.readyTimer);
    run.child.stdin.destroy();
    run.child.kill();
    run.killTimer = setTimeout(() => {
      if (!run.finished) run.child.kill('SIGKILL');
    }, 500);
    run.killTimer.unref?.();
  };

  const streamError = (run, error) => {
    reportError(run, error);
    if (active === run && !run.finished) terminate(run);
  };

  const sendTitle = () => {
    const run = active;
    if (!run?.ready || run.terminating || !run.child.stdin.writable || run.child.stdin.destroyed) return;
    const command = pendingDisplay ? 'display' : 'title';
    const encoded = Buffer.from(pendingDisplay ? JSON.stringify(pendingDisplay) : pendingTitle, 'utf8').toString('base64');
    try {
      run.child.stdin.write(`${command}\t${encoded}\n`, (error) => { if (error) streamError(run, error); });
    } catch (error) {
      streamError(run, error);
    }
  };

  const start = () => {
    if (active) return !active.terminating;
    if (Date.now() < retryAt) return false;
    const executable = options.executablePath || helperPath(options.resourcesPath);
    if (!fs.existsSync(executable)) return false;
    const run = { child: spawn(executable, options.args || [], { stdio: ['pipe', 'pipe', 'pipe'] }), ready: false };
    active = run;
    const child = run.child;
    child.on('error', (error) => {
      reportError(run, error);
      if (!child.pid) finish(run, null, null);
      else terminate(run);
    });
    for (const stream of [child.stdin, child.stdout, child.stderr]) {
      stream.on('error', (error) => streamError(run, error));
    }
    child.stderr.on('data', (chunk) => reportError(run, new Error(String(chunk).trim())));
    child.once('exit', (code, signal) => finish(run, code, signal));
    child.once('close', (code, signal) => finish(run, code, signal));
    run.readyTimer = setTimeout(() => {
      reportError(run, new Error('native status item ready timeout'));
      terminate(run);
    }, options.readyTimeoutMs ?? 5000);
    run.readyTimer.unref?.();
    run.lines = createInterface({ input: child.stdout });
    run.lines.on('line', (line) => {
      if (active !== run || run.stopping || run.terminating) return;
      const event = parseHelperEvent(line);
      if (event.type === 'ready') {
        run.ready = true;
        clearTimeout(run.readyTimer);
        sendTitle();
      } else if (event.type === 'toggle' && event.anchor) options.onToggle?.(event.anchor);
      else if (event.type === 'menu' && event.anchor) options.onContextMenu?.(event.anchor);
      else if (event.type === 'open') options.onOpen?.();
      else if (event.type === 'refresh') options.onRefresh?.();
      else if (event.type === 'settings') options.onSettings?.();
      else if (event.type === 'quit') options.onQuit?.();
      else if (event.type === 'error') options.onError?.(new Error(line));
    });
    return true;
  };

  const stop = () => {
    retryAt = 0;
    failures = 0;
    if (!active) return;
    const run = active;
    run.stopping = true;
    active = null;
    terminate(run);
  };

  return {
    isRunning: () => Boolean(active && !active.terminating),
    isReady: () => Boolean(active?.ready && !active.terminating),
    setTitle(value) {
      pendingTitle = String(value || '');
      if (pendingDisplay) pendingDisplay.title = pendingTitle;
      sendTitle();
    },
    setDisplay({ title = '', tooltip = '', image } = {}) {
      const size = image?.getSize();
      pendingDisplay = {
        title: String(title), tooltip: String(tooltip),
        image: image?.toPNG().toString('base64') || '',
        width: size?.width || 20, height: size?.height || 20,
        template: image?.isTemplateImage() === true
      };
      sendTitle();
    },
    start,
    stop
  };
}

module.exports = {
  HELPER_FILENAME,
  createNativeStatusItemBridge,
  helperPath,
  parseHelperEvent,
  trayBoundsAreVisible
};
