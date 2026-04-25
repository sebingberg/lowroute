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

## Releases

- Releases are cut from `main` with annotated tags in `vX.Y.Z` format.
- A tag push matching `v*` triggers release verification and auto-publishes a
  GitHub Release with generated notes.
- Tag naming is strict SemVer (`vMAJOR.MINOR.PATCH`).
- Hotfixes branch from `main`, merge back to `main`, then cut the next patch
  tag from `main`.

Detailed release steps: `docs/10-release-process.md`.

## Pull Request Metadata

- Use Conventional Commit style in pull request titles when possible:
  - `feat: ...`
  - `fix: ...`
  - `chore: ...`
  - `docs: ...`
- Apply labels to improve generated release notes:
  - `feat`, `fix`, `chore`, `docs`, `test`, `refactor`
  - `skip-changelog` for changes that should not appear in release notes

## Pull Request Checklist

Before requesting review, confirm all items below:

- Scope is focused and only includes task-related changes.
- Verification expectations in `AGENTS.md` are completed.
- Docs are updated when behavior, commands, or workflows changed.
- Risky changes include rollback notes or mitigation details in the PR body.
- Title and labels follow the conventions in this document.
