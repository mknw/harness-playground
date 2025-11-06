import js from '@eslint/js';
import solid from 'eslint-plugin-solid';
import tseslint from 'typescript-eslint';
import unocss from '@unocss/eslint-config/flat'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    ...solid.configs['flat/typescript'],
  },
  unocss,
  {
    files: ["src/**/*.ts", "src/**/*.tsx", "eslint.config.ts"],
    rules: {
            "prefer-const": "warn",
            "no-constant-binary-expression": "error",
            "@typescript-eslint/no-unused-vars": ["error", {
              "varsIgnorePattern": "^_|^T$",
              "argsIgnorePattern": "^_"
            }],
    },
  },
);
