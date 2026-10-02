'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function stripYamlQuotes(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function artifactNameFromReference(value) {
  const reference = stripYamlQuotes(value);
  let pathname = reference;
  try {
    pathname = new URL(reference, 'https://release.invalid/').pathname;
  } catch (_) {}
  try {
    pathname = decodeURIComponent(pathname);
  } catch (_) {}
  return path.posix.basename(pathname);
}

function referencedArtifactNames(contents) {
  const names = new Set();
  const referencePattern = /^\s*(?:-\s*)?(?:url|path):\s*(.+?)\s*$/gm;
  for (const match of contents.matchAll(referencePattern)) {
    const name = artifactNameFromReference(match[1]);
    if (name) names.add(name);
  }
  return [...names];
}

function verifyUpdaterArtifactNames(distDir) {
  const metadataFiles = fs.readdirSync(distDir)
    .filter((name) => /^latest(?:-[^.]+)?\.ya?ml$/.test(name))
    .sort();
  if (metadataFiles.length === 0) {
    throw new Error(`No updater metadata found in ${distDir}`);
  }

  const missing = [];
  for (const metadataFile of metadataFiles) {
    const contents = fs.readFileSync(path.join(distDir, metadataFile), 'utf8');
    const names = referencedArtifactNames(contents);
    if (names.length === 0) {
      throw new Error(`${metadataFile} does not reference any artifacts`);
    }
    for (const name of names) {
      if (!fs.existsSync(path.join(distDir, name))) {
        missing.push(`${metadataFile} -> ${name}`);
      }
    }
  }

  if (missing.length > 0) {
    throw new Error(`Updater metadata references missing artifacts:\n${missing.join('\n')}`);
  }
  return { metadataFiles };
}

// updater metadata entries: each `url:`/`path:` line opens a record, following
// `sha512:`/`size:` lines belong to the most recent record. This deliberately
// tolerates quoting and full URLs instead of parsing YAML, matching the name
// extraction above.
function referencedArtifactEntries(contents) {
  const entries = [];
  const referencePattern = /^\s*(?:-\s*)?(url|path):\s*(.+?)\s*$/gm;
  for (const match of contents.matchAll(referencePattern)) {
    entries.push({
      kind: match[1],
      name: artifactNameFromReference(match[2]),
      index: match.index,
      end: match.index + match[0].length
    });
  }
  const fieldPattern = /^\s*(sha512|size):\s*(.+?)\s*$/gm;
  for (const match of contents.matchAll(fieldPattern)) {
    let owner = null;
    for (const entry of entries) {
      if (entry.end <= match.index) owner = entry;
      else break;
    }
    if (!owner) continue;
    const value = stripYamlQuotes(match[2]);
    if (match[1] === 'sha512') owner.sha512 = value;
    else owner.size = Number(value);
  }
  return entries;
}

function sha512Base64(filePath) {
  return crypto.createHash('sha512').update(fs.readFileSync(filePath)).digest('base64');
}

// Post-build smoke check: every referenced artifact must exist (as above) and,
// when the metadata carries sha512/size, the bytes on disk must match. This is
// what catches a latest.yml rewritten against the wrong artifact (e.g. a
// signing step replacing the exe after hashing) before the release ships.
function verifyUpdaterArtifactIntegrity(distDir) {
  const { metadataFiles } = verifyUpdaterArtifactNames(distDir);
  const mismatches = [];
  let checked = 0;
  for (const metadataFile of metadataFiles) {
    const contents = fs.readFileSync(path.join(distDir, metadataFile), 'utf8');
    const seen = new Set();
    for (const entry of referencedArtifactEntries(contents)) {
      if (!entry.name || seen.has(entry.name)) continue;
      seen.add(entry.name);
      const filePath = path.join(distDir, entry.name);
      if (entry.sha512) {
        checked += 1;
        const actual = sha512Base64(filePath);
        if (actual !== entry.sha512) {
          mismatches.push(`${entry.name}: sha512 mismatch (metadata ${entry.sha512.slice(0, 16)}…, actual ${actual.slice(0, 16)}…)`);
        }
      }
      if (Number.isFinite(entry.size)) {
        checked += 1;
        const actualSize = fs.statSync(filePath).size;
        if (actualSize !== entry.size) {
          mismatches.push(`${entry.name}: size mismatch (metadata ${entry.size}, actual ${actualSize})`);
        }
      }
    }
  }
  if (checked === 0) {
    throw new Error('Updater metadata carries no sha512/size fields to verify');
  }
  if (mismatches.length > 0) {
    throw new Error(`Updater artifact integrity check failed:\n${mismatches.join('\n')}`);
  }
  return { metadataFiles, checked };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const integrity = args.includes('--integrity');
  const distDir = path.resolve(args.find((arg) => !arg.startsWith('--')) || 'dist');
  try {
    if (integrity) {
      const result = verifyUpdaterArtifactIntegrity(distDir);
      console.log(`Verified updater artifact integrity in ${result.metadataFiles.join(', ')} (${result.checked} checks)`);
    } else {
      const result = verifyUpdaterArtifactNames(distDir);
      console.log(`Verified updater artifact names in ${result.metadataFiles.join(', ')}`);
    }
  } catch (error) {
    console.error(error.message || String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  artifactNameFromReference,
  referencedArtifactEntries,
  referencedArtifactNames,
  verifyUpdaterArtifactIntegrity,
  verifyUpdaterArtifactNames
};
