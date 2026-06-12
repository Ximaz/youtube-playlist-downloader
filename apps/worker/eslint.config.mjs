import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Pin the parser's root to this package. Without it, typescript-eslint v8 auto-infers
    // tsconfigRootDir and errors in the monorepo (it finds multiple package roots as
    // candidates) when the IDE lints from the workspace root.
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },
);
