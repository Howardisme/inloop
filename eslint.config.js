import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'spikes/**', 'node_modules/**', '.superpowers/**'],
  },
  ...tseslint.configs.recommended,
);