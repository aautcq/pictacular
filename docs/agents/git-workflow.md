# Git workflow

One branch per issue, opened as a PR against `main`.

## Conventions

- **Never commit directly to `main`** — the husky `pre-commit` hook already blocks this locally.
- **One issue, one branch.** Create it off an up-to-date `main`: `git checkout main && git pull && git checkout -b <branch-name>`.
- **Open a PR against `main`** once the issue is done: `gh pr create --base main --title "..." --body "..."`, linking the issue (e.g. `Closes #<n>`).

## Branch naming

`<prefix>/<issue-id>-<description>`, using [Conventional Commits](https://www.conventionalcommits.org/) prefixes:

- `feat/123-add-image-upload`
- `fix/456-broken-thumbnail-cache`
- `chore/789-bump-nuxt`
- `docs/12-add-git-workflow-doc`

`<issue-id>` is the GitHub issue number. `<description>` is a short kebab-case summary of the issue title.
