import eslintConfig from '@antfu/eslint-config'

export default eslintConfig(
  {},
  {
    files: ['**/*-sw.js'],
    rules: { 'no-restricted-globals': 'off' },
  },
)
