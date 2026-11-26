import { describe, expect, it } from 'vitest';
import {
  extractChangelogSection,
  parseTag
} from '../../../scripts/create-github-releases.mjs';

describe('create-github-releases script helpers', () => {
  it('parses scoped and unscoped changeset tags and ignores plain semver tags', () => {
    expect(parseTag('@pixerate/conversations@0.1.1')).toEqual({
      name: '@pixerate/conversations',
      version: '0.1.1'
    });
    expect(parseTag('conversations@1.2.3')).toEqual({
      name: 'conversations',
      version: '1.2.3'
    });
    expect(parseTag('v0.1.1')).toBeNull();
    expect(parseTag('')).toBeNull();
  });

  it('extracts matching version section from CHANGELOG.md', () => {
    const changelog = `# @pixerate/conversations

## 0.2.0

### Minor Changes

- Added text-range anchoring.

## 0.1.1

### Patch Changes

- Open-sourced under MIT.
`;

    expect(extractChangelogSection(changelog, '0.2.0')).toBe(
      '### Minor Changes\n\n- Added text-range anchoring.'
    );
    expect(extractChangelogSection(changelog, '0.1.1')).toBe(
      '### Patch Changes\n\n- Open-sourced under MIT.'
    );
    expect(extractChangelogSection(changelog, '9.9.9')).toBe('');
  });
});
