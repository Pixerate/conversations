import tseslint from 'typescript-eslint';

const pixerateBoundaryPatterns = [
  {
    group: ['@pixerate/editor', '@pixerate/editor/*'],
    message:
      'Rich text editing belongs in @pixerate/editor; do not import it in @pixerate/conversations (see AGENTS.md).',
  },
  {
    group: ['@pixerate/notifications', '@pixerate/notifications/*'],
    message:
      'Notifications belong in @pixerate/notifications; do not import them in @pixerate/conversations (see AGENTS.md).',
  },
  {
    group: ['@pixerate/realtime', '@pixerate/realtime/*'],
    message:
      'Ephemeral presence belongs in @pixerate/realtime; do not import it in @pixerate/conversations (see AGENTS.md).',
  },
  {
    group: ['@pixerate/teams', '@pixerate/teams/*'],
    message:
      'Team RBAC belongs in @pixerate/teams; do not import it in @pixerate/conversations (see AGENTS.md).',
  },
];

const coreDriverFrameworkPatterns = [
  {
    group: [
      'svelte',
      'svelte/*',
      'react',
      'react-dom',
      'react/*',
      'react-dom/*',
      '../svelte',
      '../svelte.js',
      '../svelte/*',
      '../react',
      '../react.js',
      '../react/*',
      '$lib/svelte',
      '$lib/svelte.js',
      '$lib/svelte/*',
      '$lib/react',
      '$lib/react.js',
      '$lib/react/*',
    ],
    message:
      'src/lib/core/ and src/lib/drivers/ must remain UI-agnostic and never import Svelte or React (see AGENTS.md).',
  },
];

export default [
  {
    files: ['src/lib/**/*.ts'],
    ignores: ['src/lib/__tests__/**'],
    languageOptions: {
      parser: tseslint.parser,
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: pixerateBoundaryPatterns,
        },
      ],
    },
  },
  {
    files: ['src/lib/core/**/*.ts', 'src/lib/drivers/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [...pixerateBoundaryPatterns, ...coreDriverFrameworkPatterns],
        },
      ],
    },
  },
  {
    files: ['src/lib/svelte/**/*.ts', 'src/lib/svelte.ts'],
    languageOptions: {
      parser: tseslint.parser,
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...pixerateBoundaryPatterns,
            {
              group: ['react', 'react/*', 'react-dom', 'react-dom/*'],
              message: 'src/lib/svelte/ must not import React (see AGENTS.md).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/lib/react/**/*.ts', 'src/lib/react.ts'],
    languageOptions: {
      parser: tseslint.parser,
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...pixerateBoundaryPatterns,
            {
              group: ['svelte', 'svelte/*'],
              message: 'src/lib/react/ must not import Svelte (see AGENTS.md).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/lib/**/*.test.*', 'src/lib/**/*.spec.*'],
    ignores: ['src/lib/__tests__/**'],
    languageOptions: {
      parser: tseslint.parser,
    },
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Program',
          message:
            'Unit tests must live in src/lib/__tests__/*.test.ts (see AGENTS.md).',
        },
      ],
    },
  },
];
