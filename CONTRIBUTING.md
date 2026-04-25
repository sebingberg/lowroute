# Contributing

## Canonical Guidance

- Use `AGENTS.md` as the source of truth for project commands, verification
  expectations, runtime/domain guardrails, and documentation contract.
- Use `README.md` for technical onboarding and local setup flow.

## Branch Strategy

- `main` is the only long-lived branch.
- Do not use a permanent `dev` branch.
- Create short-lived branches from `main` using one of these prefixes:
  - `feat/<short-topic>`
  - `fix/<short-topic>`
  - `chore/<short-topic>`
  - `docs/<short-topic>`

## Pull Requests

- Open pull requests against `main`.
- Keep pull requests focused and small enough to review quickly.
- Prefer squash merges to keep `main` history concise.
- Follow verification expectations in `AGENTS.md` before requesting review.
- Use the PR body template from `.github/pull_request_template.md` (mirrored
  in `.cursor/templates/pr-template.md` for agents). It matches the structure
  used by the personal `create-commit-plan` skill (`Context`, `Changes`,
  `Test Plan`, `Reviewer Notes`). When you change one file, update the other in
  the same commit so they stay identical.

### GitHub repository settings (manual)

These cannot live in git; enable them once on the repo (or org) **Settings**:

- **Pull requests**: turn on **Automatically delete head branches** so merged
  feature branches are removed from the remote.
- **Pull requests** (optional): default merge style **Squash and merge** if
  you want it pre-selected in the UI.

Merging into `main` already closes the PR; deleting the head branch is the
extra cleanup above.

### PR automation (CI)

Workflow `.github/workflows/pr-automation.yml` runs on pull requests targeting
`main` from **this** repository only (not forks):

- Assigns the pull request **author** when a PR is opened or reopened.
- Syncs GitHub **labels** `feat`, `fix`, `refactor`, `chore`, `docs`, `test`,
  `perf` from the **PR title** (Conventional Commits, with or without scope).
  If the title has no type, it falls back to the **branch prefix** (for example
  `feat/…`, `fix/…`).
- Labels are created automatically the first time they are needed. Add
  `skip-changelog` or other labels manually when they apply; automation only
  manages the Conventional Commit type set above.

### Dependency update pull requests

Dependabot opens npm and GitHub Actions update PRs from
`.github/dependabot.yml`. For dependency-only changes:

- Keep the PR focused on the generated manifest, lockfile, or workflow update.
- Confirm `pnpm install --frozen-lockfile` succeeds after lockfile changes.
- Use `pnpm audit` as an npm advisory cross-check only; GitHub Dependabot
  alerts are confirmed through GitHub Security Advisories after a rescan.
- Add the `dependencies` label manually when the change should be excluded from
  generated release notes.

## Releases

- Releases are cut from `main` with annotated tags in `vX.Y.Z` format.
- A tag push matching `v*` triggers release verification and auto-publishes a
  GitHub Release with generated notes.
- Tag naming is strict SemVer (`vMAJOR.MINOR.PATCH`).
- Hotfixes branch from `main`, merge back to `main`, then cut the next patch
  tag from `main`.

Detailed release steps: `docs/10-release-process.md`.

## Pull Request Metadata

- Use Conventional Commits in the **PR title** (for example `feat(api): …` or
  `chore: …`). CI applies matching type labels for release note grouping (see
  `.github/release.yml`).
- Link issues in **Context** with `Fixes #123` or `Closes #123` when applicable
  so GitHub closes them on merge.
- Add `skip-changelog` or `dependencies` manually when the change should be
  excluded from generated release notes. The `ci` label is grouped under
  Maintenance when release notes are generated.

## Pull Request Checklist

Before requesting review, confirm all items below:

- Scope is focused and only includes task-related changes.
- Verification expectations in `AGENTS.md` are completed.
- Docs are updated when behavior, commands, or workflows changed.
- Risky changes include rollback notes or mitigation details in **Reviewer
  Notes** (or Context when short).
- PR title follows Conventional Commits so automation can set the type label.
