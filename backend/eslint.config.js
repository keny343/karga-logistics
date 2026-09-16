import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: { project: './tsconfig.typecheck.json' },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // An awaited non-promise usually means a forgotten async boundary.
      '@typescript-eslint/no-explicit-any': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
    },
  },
);
