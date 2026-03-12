import eslint from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';

const options = {
  languageOptions: {
    globals: {
      ...globals.node,
    },
  },
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
  },
};

export default defineConfig(
  globalIgnores(['**/dist/*', '**/node_modules/*']),
  eslint.configs.recommended,
  tseslint.configs.recommended,
  eslintPluginPrettierRecommended,
  options,
);
