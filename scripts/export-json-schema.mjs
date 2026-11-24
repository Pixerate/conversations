#!/usr/bin/env node
// Exports deterministic JSON Schemas from built Zod schemas in `dist/types.js`.
//
// Usage:
//   node scripts/export-json-schema.mjs          # Writes json-schema/*.json
//   node scripts/export-json-schema.mjs --check  # Exits 1 if json-schema/ is out of date

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { zodToJsonSchema } from 'zod-to-json-schema';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const defaultOutputDir = path.resolve(rootDir, 'json-schema');
const defaultTypesPath = path.resolve(rootDir, 'dist', 'types.js');

const SCHEMA_EXPORTS = [
  { name: 'NotificationActor', exportName: 'NotificationActorSchema' },
  { name: 'EntityRef', exportName: 'EntityRefSchema' },
  { name: 'TextQuoteSelector', exportName: 'TextQuoteSelectorSchema' },
  { name: 'TextAnchorState', exportName: 'TextAnchorStateSchema' },
  { name: 'TextAnchor', exportName: 'TextAnchorSchema' },
  { name: 'MessageStatus', exportName: 'MessageStatusSchema' },
  { name: 'MessageReaction', exportName: 'MessageReactionSchema' },
  { name: 'Message', exportName: 'MessageSchema' },
  { name: 'ConversationStatus', exportName: 'ConversationStatusSchema' },
  { name: 'Conversation', exportName: 'ConversationSchema' }
];

/**
 * Loads the built `dist/types.js` module and generates deterministic JSON Schema strings.
 * @param {string} [typesPath]
 * @returns {Promise<Map<string, string>>}
 */
export async function generateJsonSchemas(typesPath = defaultTypesPath) {
  if (!fs.existsSync(typesPath)) {
    throw new Error(
      `Missing ${path.relative(rootDir, typesPath)}. Run \`npm run build\` (or \`svelte-package\`) first.`
    );
  }

  /** @type {Record<string, unknown>} */
  const typesModule = await import(pathToFileURL(typesPath).href);

  /** @type {Record<string, any>} */
  const definitions = {};
  for (const entry of SCHEMA_EXPORTS) {
    const schema = typesModule[entry.exportName];
    if (!schema) {
      throw new Error(`Missing schema export \`${entry.exportName}\` in ${typesPath}`);
    }
    definitions[entry.name] = schema;
  }

  /** @type {Map<string, string>} */
  const files = new Map();
  /** @type {Array<{ name: string; file: string }>} */
  const indexSchemas = [];

  for (const entry of SCHEMA_EXPORTS) {
    const schema = definitions[entry.name];
    const jsonSchema = zodToJsonSchema(schema, {
      $refStrategy: 'none',
      target: 'jsonSchema7'
    });
    const file = `${entry.name}.json`;
    indexSchemas.push({ name: entry.name, file });
    files.set(file, JSON.stringify(jsonSchema, null, 2) + '\n');
  }

  files.set(
    'index.json',
    JSON.stringify(
      {
        schemaVersion: 1,
        schemas: indexSchemas
      },
      null,
      2
    ) + '\n'
  );

  return files;
}

/**
 * Verifies that `outputDir` matches generated JSON Schemas with no missing, stale, or extra `.json` files.
 * @param {{ outputDir?: string; typesPath?: string }} [options]
 * @returns {Promise<{ ok: boolean; errors: string[]; verifiedCount: number }>}
 */
export async function verifyJsonSchemas(options = {}) {
  const outputDir = options.outputDir ?? defaultOutputDir;
  const typesPath = options.typesPath ?? defaultTypesPath;
  const generated = await generateJsonSchemas(typesPath);
  /** @type {string[]} */
  const errors = [];

  for (const [relPath, expected] of generated.entries()) {
    const fullPath = path.resolve(outputDir, relPath);
    if (!fs.existsSync(fullPath)) {
      errors.push(`Missing JSON Schema file: ${relPath}`);
    } else if (fs.readFileSync(fullPath, 'utf8') !== expected) {
      errors.push(`Stale JSON Schema file: ${relPath}`);
    }
  }

  if (fs.existsSync(outputDir)) {
    for (const entry of fs.readdirSync(outputDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.json') && !generated.has(entry.name)) {
        errors.push(`Unexpected extra file in json-schema: ${entry.name}`);
      } else if (entry.isDirectory()) {
        errors.push(`Unexpected subdirectory in json-schema: ${entry.name}`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    verifiedCount: generated.size
  };
}

/**
 * @param {string[]} [argv]
 * @param {{ outputDir?: string; typesPath?: string }} [options]
 * @returns {Promise<boolean>}
 */
export async function run(argv = process.argv.slice(2), options = {}) {
  const isCheck = argv.includes('--check');
  const outputDir = options.outputDir ?? defaultOutputDir;
  const typesPath = options.typesPath ?? defaultTypesPath;

  if (isCheck) {
    const result = await verifyJsonSchemas({ outputDir, typesPath });
    if (!result.ok) {
      for (const err of result.errors) {
        console.error(err);
      }
      console.error(
        'JSON Schema check failed: files are stale or out of sync. Run `npm run export:json-schema` to update.'
      );
      return false;
    }
    console.log(`JSON Schema check passed (${result.verifiedCount} files verified).`);
    return true;
  }

  const generated = await generateJsonSchemas(typesPath);
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  for (const [relPath, content] of generated.entries()) {
    fs.writeFileSync(path.resolve(outputDir, relPath), content, 'utf8');
  }
  console.log(`Exported ${generated.size} JSON Schema files to ${outputDir}`);
  return true;
}

const isDirectExecution =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectExecution) {
  run()
    .then(ok => {
      if (!ok) process.exit(1);
    })
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}
