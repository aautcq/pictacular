export default {
  '*.{js,ts,vue}': 'eslint --fix',
  // Type-checking is whole-project, not file-scoped: ignore the staged
  // filenames lint-staged passes in and re-run the full check instead.
  '*.{ts,vue}': () => 'npm run typecheck',
}
