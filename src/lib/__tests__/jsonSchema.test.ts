import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyJsonSchemas } from '../../../scripts/export-json-schema.mjs';

const jsonSchemaDir = path.resolve(process.cwd(), 'json-schema');
const distTypesPath = path.resolve(process.cwd(), 'dist', 'types.js');

describe('JSON Schema exports', () => {
  it('ships valid Draft-07 JSON Schemas for all canonical models including TextAnchor', () => {
    const indexPath = path.join(jsonSchemaDir, 'index.json');
    expect(fs.existsSync(indexPath)).toBe(true);

    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    expect(index.schemaVersion).toBe(1);
    const names = index.schemas.map((s: { name: string }) => s.name);
    expect(names).toContain('Conversation');
    expect(names).toContain('Message');
    expect(names).toContain('TextAnchor');
    expect(names).toContain('TextQuoteSelector');

    for (const entry of index.schemas as Array<{ name: string; file: string }>) {
      const schemaFile = path.join(jsonSchemaDir, entry.file);
      expect(fs.existsSync(schemaFile)).toBe(true);
      const parsed = JSON.parse(fs.readFileSync(schemaFile, 'utf8'));
      expect(parsed.$schema).toBe('http://json-schema.org/draft-07/schema#');
    }

    const convoSchema = JSON.parse(
      fs.readFileSync(path.join(jsonSchemaDir, 'Conversation.json'), 'utf8')
    );
    expect(convoSchema.properties).toHaveProperty('anchor');
  });

  it('matches the built Zod schemas (export-json-schema --check)', async () => {
    if (!fs.existsSync(distTypesPath)) {
      return;
    }
    const result = await verifyJsonSchemas();
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.verifiedCount).toBe(11);
  });
});
