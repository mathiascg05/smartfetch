// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * Flat ESLint configuration.
 *
 * Type-aware linting is enabled for the library source, where the extra rules
 * pay for themselves. Tests get the same base rules but relax the ones that
 * fight legitimate testing patterns (mock doubles, deliberate `any`).
 * `eslint-config-prettier` goes last so Prettier owns all formatting.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**'],
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
      // Unused args are allowed when prefixed with `_` (used by interceptor and
      // adapter signatures that must match a shape without using every param).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // The interceptor chain deliberately erases types while the value flows
      // from RequestConfig to SmartFetchResponse; see src/client.ts.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
    },
  },

  {
    files: ['tests/**/*.ts', 'example.ts'],
    rules: {
      // Mock fetch adapters are declared `async` to return a promise without
      // ever awaiting anything; that is the point of the double.
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },

  {
    files: ['**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },

  prettier,
);
