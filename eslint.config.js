import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-restricted-syntax': [
        'warn',
        {
          selector: "CallExpression[callee.property.name='lte'] > Literal[value='month']",
          message: "Use .lt('month', nextMonth) instead of .lte('month', endMonth) — month column stores the first of the month, so .lte includes the next month. See CLAUDE.md.",
        },
      ],
    },
  },
])
