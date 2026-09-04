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
    const centerX = bounds.x + bounds.width / 2;
    const withinHorizontal = centerX >= area.x && centerX < area.x + area.width;
    const menuBarBottom = Math.max(area.y, workArea.y) + 6;
    return withinHorizontal && bounds.y >= area.y && bounds.y < menuBarBottom;
  });
}

function parseHelperEvent(line) {
  const parts = String(line || '').trim().split('\t');
  if (parts[0] !== 'toggle') return { type: parts[0] || 'unknown' };
  const values = parts.slice(1, 5).map(Number);
  const anchor = values.every(Number.isFinite)
    ? { x: values[0], y: values[1], width: values[2], height: values[3] }
    : null;
  return { type: 'toggle', anchor };
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
  let child = null;
  let ready = false;
  let pendingTitle = '';
  let stopping = false;

  const reportError = (error) => {
    if (!error || error.code === 'EPIPE' || stopping) return;
    options.onError?.(error);
  };

  const sendTitle = () => {
    if (!ready || !child?.stdin?.writable || child.stdin.destroyed || child.stdin.writableEnded) return;
    const encoded = Buffer.from(pendingTitle, 'utf8').toString('base64');
    try {
      child.stdin.write(`title\t${encoded}\n`, (error) => reportError(error));
    } catch (error) {
      reportError(error);
    }
  };

  const start = () => {
    if (child) return true;
    const executable = options.executablePath || helperPath(options.resourcesPath);
    if (!fs.existsSync(executable)) return false;
    stopping = false;
    child = spawn(executable, options.args || [], { stdio: ['pipe', 'pipe', 'pipe'] });
    child.on('error', reportError);
    child.stdin.on('error', reportError);
    child.stdout.on('error', reportError);
    child.stderr.on('error', reportError);
    child.stderr.on('data', (chunk) => reportError(new Error(String(chunk).trim())));
    child.once('exit', (code, signal) => {
      const exitedUnexpectedly = !stopping;
      child = null;
      ready = false;
      if (code && !signal) options.onError?.(new Error(`native status item exited with code ${code}`));
      if (exitedUnexpectedly) options.onExit?.({ code, signal });
    });
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      const event = parseHelperEvent(line);
      if (event.type === 'ready') {
        ready = true;
        sendTitle();
      } else if (event.type === 'toggle') options.onToggle?.(event.anchor);
      else if (event.type === 'open') options.onOpen?.();
      else if (event.type === 'refresh') options.onRefresh?.();
      else if (event.type === 'settings') options.onSettings?.();
      else if (event.type === 'quit') options.onQuit?.();
      else if (event.type === 'error') options.onError?.(new Error(line));
    });
    return true;
  };

  const stop = () => {
    if (!child) return;
    stopping = true;
    const current = child;
    child = null;
    ready = false;
    current.stdin.end();
    setTimeout(() => {
      if (!current.killed) current.kill();
    }, 500).unref?.();
  };

  return {
    isRunning: () => Boolean(child),
    setTitle(value) {
      pendingTitle = String(value || '');
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
