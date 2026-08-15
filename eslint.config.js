// ESLint flat config (ESLint v9). See https://eslint.org/docs/latest/use/configure/
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    // Lint only src/ TypeScript. Config files and build output are excluded so
    // the type-checked rules don't try to type-check files outside the TS project.
    ignores: [
      'design/**',
      'dist/**',
      'node_modules/**',
      'media/**',
      'state/**',
      'scripts/**',
      'public/**',
      'assets/**',
      // Claude Code worktree checkouts live here; they are copies of the repo and
      // must never be linted as part of the main project (their files are not in
      // this project's tsconfig service).
      '.claude/**',
      // Planning-workstream source documents (D-110). The two probe scripts there are
      // committed AS RECEIVED and unaltered, are standalone Node scripts run by hand
      // against a SQLite file, and are not part of this project's tsconfig service.
      // Linting them would demand edits the intake rule forbids, so the check's scope
      // is decided here rather than by whether the parser happens to reach them
      // (the D-105 discipline: a new tree does not inherit a check by default).
      'docs/planning/**',
      '*.js',
      '*.mjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  // The migration runner and startup path legitimately log to the console.
  prettier,
);
