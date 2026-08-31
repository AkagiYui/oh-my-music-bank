import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
export default tseslint.config(
  {
    ignores: ['dist/**', 'src/routeTree.gen.ts'],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { 'react-hooks': reactHooks, '@typescript-eslint': tseslint.plugin },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'none',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
);
