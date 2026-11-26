import { describe, expect, it } from 'vitest';
import {
  extractChangelogSection,
  parseTag
} from '../../../scripts/create-github-releases.mjs';

describe('create-github-releases script helpers', () => {
  it('parses single-package v<semver> tags, scoped/unscoped changeset tags, and rejects non-release strings', () => {
    expect(parseTag('v0.2.0')).toEqual({
      name: null,
      version: '0.2.0'
    });
    expect(parseTag('v1.0.0-rc.1')).toEqual({
      name: null,
      version: '1.0.0-rc.1'
    });
    expect(parseTag('@pixerate/conversations@0.2.0')).toEqual({
      name: '@pixerate/conversations',
      version: '0.2.0'
    });
    expect(parseTag('conversations@1.2.3')).toEqual({
      name: 'conversations',
      version: '1.2.3'
    });
    expect(parseTag('main')).toBeNull();
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
