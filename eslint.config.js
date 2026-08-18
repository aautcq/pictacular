import eslintConfig from '@antfu/eslint-config'

export default eslintConfig(
  {
    // Vendored agent-skill content and generated docs are not part of the
    // app's own source and shouldn't be reformatted by this project's lint.
    ignores: ['.agents/**', 'docs/**', 'skills-lock.json'],
  },
  {
    files: ['**/*-sw.js'],
    rules: { 'no-restricted-globals': 'off' },
  },
)
