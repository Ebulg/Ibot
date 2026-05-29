import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        document: 'readonly',
        window: 'readonly',
        fetch: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        EventSource: 'readonly',
        URLSearchParams: 'readonly',
        decodeURIComponent: 'readonly',
        encodeURIComponent: 'readonly',
        Buffer: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['warn', { 'argsIgnorePattern': '^_|^req$|^res$|^next$' }],
      'no-empty': 'warn',
    }
  }
];
