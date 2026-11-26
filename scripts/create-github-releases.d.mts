#!/usr/bin/env node
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
export function extractChangelogSection(changelogContent: string, version: string): string;
/**
 * Parses a changeset tag in `<pkg>@<version>` format (for example `@pixerate/conversations@0.1.1`).
 * Returns null for non-changeset tags such as plain `v0.1.1`.
 * @param {string} tag
 * @returns {{ name: string; version: string } | null}
 */
export function parseTag(tag: string): {
    name: string;
    version: string;
} | null;
/**
 * @param {string} tag
 * @returns {boolean}
 */
export function releaseExists(tag: string): boolean;
/**
 * @param {string[]} [argv]
 * @param {string} [baseDir]
 * @returns {Promise<boolean>}
 */
export function run(argv?: string[], baseDir?: string): Promise<boolean>;
export type ReleaseScriptOptions = {
    singleTag: string | null;
    backfill: boolean;
    dryRun: boolean;
};
