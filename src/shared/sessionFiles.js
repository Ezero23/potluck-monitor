'use strict';

const fs = require('node:fs');
const path = require('node:path');

function findSessionFiles(root, sessionIds) {
  const wanted = new Set(Array.from(sessionIds).map((id) => `${id}.jsonl`));
  const found = new Map();
  if (wanted.size === 0) return found;

  function walk(dir) {
    if (found.size >= wanted.size) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      if (found.size >= wanted.size) return;
      const nextPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(nextPath);
      } else if (entry.isFile() && wanted.has(entry.name)) {
        found.set(entry.name.slice(0, -'.jsonl'.length), nextPath);
      }
    }
  }

  walk(root);
  return found;
}

// Kimi Code sessions live at <kimiHome>/sessions/<workspace>/<sessionId>/ with a
// state.json carrying createdAt/updatedAt — there is no JSONL transcript to tail.
function findKimiStateFiles(home, sessionIds) {
  const wanted = new Set(Array.from(sessionIds || []));
  const found = new Map();
  if (wanted.size === 0) return found;
  const roots = [
    path.join(home, '.kimi', 'sessions'),
    path.join(process.env.KIMI_CODE_HOME || path.join(home, '.kimi-code'), 'sessions')
  ];
  for (const root of roots) {
    let workspaces;
    try { workspaces = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { continue; }
    for (const workspace of workspaces) {
      if (!workspace.isDirectory()) continue;
      let entries;
      try { entries = fs.readdirSync(path.join(root, workspace.name), { withFileTypes: true }); } catch (_) { continue; }
      for (const entry of entries) {
        if (!entry.isDirectory() || !wanted.has(entry.name) || found.has(entry.name)) continue;
        const statePath = path.join(root, workspace.name, entry.name, 'state.json');
        try { if (fs.statSync(statePath).isFile()) found.set(entry.name, statePath); } catch (_) {}
      }
    }
  }
  return found;
}

function codexSessionFile(home, sessionId) {
  const match = String(sessionId || '').match(/^rollout-(\d{4})-(\d{2})-(\d{2})T/);
  if (!match) return '';
  const filePath = path.join(home, '.codex', 'sessions', match[1], match[2], match[3], `${sessionId}.jsonl`);
  try { return fs.statSync(filePath).isFile() ? filePath : ''; } catch (_) { return ''; }
}

function resolveSessionFile(client, sessionId, home) {
  const id = String(sessionId || '');
  if (!id) return '';
  if (client === 'claude') {
    return findSessionFiles(path.join(home, '.claude', 'projects'), [id]).get(id) || '';
  }
  if (client === 'codex') {
    const direct = codexSessionFile(home, id);
    if (direct) return direct;
    return findSessionFiles(path.join(home, '.codex', 'sessions'), [id]).get(id) || '';
  }
  return '';
}

module.exports = { findSessionFiles, findKimiStateFiles, codexSessionFile, resolveSessionFile };
