import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
// import hono from "@hono/eslint-config";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: ["dist/", "node_modules/"],
  },

  {
    files: ["**/*.ts"],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      prettier,
    ],
    languageOptions: {
      parserOptions: {
        // This is the crucial part that enables type-aware linting.
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  {
    files: ["**/*.js", "**/*.mjs"],
    extends: [eslint.configs.recommended, prettier],
  },
);
