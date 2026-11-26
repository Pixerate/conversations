#!/usr/bin/env node
// Creates GitHub Releases for published package tags, copying the corresponding
// section from CHANGELOG.md into the release body.
//
// Usage:
//   node scripts/create-github-releases.mjs              # Releases all tags pointing at HEAD
//   node scripts/create-github-releases.mjs --tag <tag>  # Releases a single tag
//   node scripts/create-github-releases.mjs --backfill   # Releases all tags missing GitHub releases
//   node scripts/create-github-releases.mjs --dry-run    # Preview without creating releases

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @typedef {Object} ReleaseScriptOptions
 * @property {string | null} singleTag
 * @property {boolean} backfill
 * @property {boolean} dryRun
 */

/**
 * Extracts the changelog section for a given version from CHANGELOG.md.
 * @param {string} changelogContent
 * @param {string} version
 * @returns {string}
 */
export function extractChangelogSection(changelogContent, version) {
  if (!changelogContent || !version) return '';
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`## \\b${escapedVersion}\\b[^\\n]*\\n([\\s\\S]*?)(?=\\n## |$)`);
  const match = changelogContent.match(regex);
  return match ? match[1].trim() : '';
}

/**
 * Parses a release tag in either `<pkg>@<version>` format (monorepo changeset tags such as
 * `@pixerate/conversations@0.1.1`) or `v<semver>` format (single-package changeset tags such
 * as `v0.2.0`).
 * @param {string} tag
 * @returns {{ name: string | null; version: string } | null}
 */
export function parseTag(tag) {
  if (typeof tag !== 'string' || !tag) return null;

  const semverMatch = tag.match(
    /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/
  );
  if (semverMatch) {
    return { name: null, version: semverMatch[1] };
  }

  const atIndex = tag.lastIndexOf('@');
  if (atIndex <= 0) return null;
  const name = tag.slice(0, atIndex);
  const version = tag.slice(atIndex + 1);
  if (!name || !version) return null;
  return { name, version };
}

/**
 * @param {string} tag
 * @returns {boolean}
 */
export function releaseExists(tag) {
  try {
    execFileSync('gh', ['release', 'view', tag], {
      stdio: 'ignore'
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} [baseDir]
 * @returns {string | null}
 */
function getRootPackageName(baseDir = rootDir) {
  const pkgPath = path.join(baseDir, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  const pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  return typeof pkgJson.name === 'string' ? pkgJson.name : null;
}

/**
 * @param {ReleaseScriptOptions} options
 * @param {string | null} packageName
 * @returns {string[]}
 */
function getTagsToProcess(options, packageName) {
  if (options.singleTag) {
    return [options.singleTag];
  }

  if (options.backfill) {
    const patterns = packageName ? ['v*', `${packageName}@*`] : ['v*', '*@*'];
    const raw = execFileSync('git', ['tag', '--list', ...patterns], {
      encoding: 'utf8'
    });
    return raw
      .split('\n')
      .map(t => t.trim())
      .filter(Boolean);
  }

  const raw = execFileSync('git', ['tag', '--points-at', 'HEAD'], {
    encoding: 'utf8'
  });
  return raw
    .split('\n')
    .map(t => t.trim())
    .filter(Boolean);
}

/**
 * @param {string} tag
 * @param {string | null} packageName
 * @param {string} baseDir
 * @param {ReleaseScriptOptions} options
 * @returns {boolean}
 */
function createRelease(tag, packageName, baseDir, options) {
  const parsed = parseTag(tag);
  if (!parsed || (parsed.name !== null && packageName && parsed.name !== packageName)) {
    console.log(`Skipping tag '${tag}' (not a release tag for '${packageName || 'package'}').`);
    return true;
  }

  if (releaseExists(tag)) {
    console.log(`Release for '${tag}' already exists on GitHub.`);
    return true;
  }

  let notes = '';
  const changelogPath = path.join(baseDir, 'CHANGELOG.md');
  if (fs.existsSync(changelogPath)) {
    const changelogContent = fs.readFileSync(changelogPath, 'utf8');
    notes = extractChangelogSection(changelogContent, parsed.version);
  }

  if (options.dryRun) {
    console.log(`[dry-run] Would create GitHub release for '${tag}'`);
    if (notes) {
      console.log(`--- Notes preview ---\n${notes}\n---------------------`);
    } else {
      console.log('(no changelog entry found, would use --generate-notes)');
    }
    return true;
  }

  console.log(`Creating GitHub release for '${tag}'...`);
  const ghArgs = ['release', 'create', tag, '--title', tag];

  /** @type {string | null} */
  let tempFile = null;
  if (notes) {
    tempFile = path.join(
      os.tmpdir(),
      `release-notes-${Date.now()}-${Math.random().toString(36).slice(2)}.md`
    );
    fs.writeFileSync(tempFile, notes, 'utf8');
    ghArgs.push('--notes-file', tempFile);
  } else {
    ghArgs.push('--generate-notes');
  }

  try {
    execFileSync('gh', ghArgs, { stdio: 'inherit' });
    console.log(`Successfully created release for '${tag}'.`);
    return true;
  } catch (err) {
    console.error(`Failed to create release for '${tag}':`, err);
    return false;
  } finally {
    if (tempFile && fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  }
}

/**
 * @param {string[]} [argv]
 * @param {string} [baseDir]
 * @returns {Promise<boolean>}
 */
export async function run(argv = process.argv.slice(2), baseDir = rootDir) {
  /** @type {ReleaseScriptOptions} */
  const options = {
    singleTag: null,
    backfill: false,
    dryRun: false
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--tag' && argv[i + 1]) {
      options.singleTag = argv[++i];
    } else if (arg === '--backfill') {
      options.backfill = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    }
  }

  const packageName = getRootPackageName(baseDir);
  const tags = getTagsToProcess(options, packageName);
  if (tags.length === 0) {
    console.log('No release tags found to process.');
    return true;
  }

  let hasErrors = false;
  for (const tag of tags) {
    const ok = createRelease(tag, packageName, baseDir, options);
    if (!ok) hasErrors = true;
  }

  return !hasErrors;
}

const isDirectExecution =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectExecution) {
  run().then(ok => {
    if (!ok) process.exit(1);
  });
}
