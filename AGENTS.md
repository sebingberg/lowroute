# Lowroute Agent Guidance

## Project Shape

- Runtime: Node.js `>=24.0`, TypeScript ESM, pnpm workspaces.
- App: `apps/service` runs a Hono HTTP API inside the worker process.
- Packages: `config`, `domain`, `providers`, `notifications`, and
  `persistence`.
- `packages/notifications` uses `packages/notifications/vitest.config.ts` to
  alias `@lowroute/config` and `@lowroute/domain` to sibling `src` entry
  points so `pnpm --filter @lowroute/notifications test` does not require
  building those packages first.
- Database: PostgreSQL migrations live under `infra/migrations`.
- Tests: Vitest unit tests are co-located with source as `*.test.ts`.

## Commands

- Install: `pnpm install --frozen-lockfile`.
- Lint: `pnpm lint`.
- Typecheck without emit: `pnpm typecheck`.
- Build emitted artifacts: `pnpm build`.
- Test: `pnpm test`.
- Install Git hooks: `pnpm hooks:install`.
- Fast precommit routine: `pnpm precommit:fast`.
- Full precommit routine: `pnpm precommit`.
- Local DB migration: `pnpm migrate:up` and `pnpm migrate:down`.
- pg-boss smoke: `pnpm smoke:provider` after Postgres is reachable.

## Tooling Conventions

- Keep root `typecheck` no-emit. `tsconfig.typecheck.json` checks source
  across `apps`, `packages`, and `scripts`, and excludes `dist`.
- Keep package `build` scripts responsible for emitting `dist`.
- Keep package `types` metadata pointed at `dist/index.d.ts`.
- Exclude `**/*.test.ts` from package build output.
- CI must use `pnpm install --frozen-lockfile`; do not weaken lockfile drift
  detection.
- Dependabot owns weekly npm and GitHub Actions updates in
  `.github/dependabot.yml`. Keep dependency PRs focused on manifests,
  lockfiles, and workflow pins.
- Treat GitHub Dependabot alerts as authoritative for GHSA closure. `pnpm audit`
  is a useful npm advisory cross-check, but it does not prove GitHub alerts are
  closed until GitHub rescans the updated manifest and lockfile.
- Lefthook owns committed Git hook config in `lefthook.yml`.
- `pre-commit` should stay Docker-free and run `pnpm precommit:fast`;
  `pre-push` may run Docker-backed checks with `pnpm precommit`.

## Runtime Safety

- Do not use `z.coerce.boolean()` for env booleans. Parse `"true"` and
  `"false"` explicitly in `packages/config/src/env.ts`.
- `TELEGRAM_ALERTS_ENABLED` is a kill switch and must default to `false`.
- `ALERT_DRY_RUN` must log rendered alert payloads and must not call Telegram.
- Hono app changes must preserve actual server startup in
  `apps/service/src/index.ts`; route wiring alone is insufficient.
- pg-boss queue checks use `createQueue()`, `send()`, and `work()` handlers
  that receive arrays.
- Outbound Telegram sends need timeout, bounded retry, and non-2xx logging.
- Shared packages must not run side effects at import time. Use lazy
  factories like `getPool()` instead of constructing pools or reading env at
  module top level.
- `node-pg-migrate` `-d` is `--database-url-var` (an env-var name). Use the
  default `DATABASE_URL` lookup or pass `-d DATABASE_URL`; never pass the
  expanded URL.

## Domain Rules

- Keep pricing currency-safe. Domain offer contracts use `Money` for quoted
  and normalized payable amounts.
- `PaymentPath` includes `foreign_card`, `ar_card`, and
  `merchant_outside_ar`. Keep merchant-country fixtures consistent with the
  selected path.
- AR tax applies only to documented AR-merchant exception classes. Do not
  apply AR tax solely because `merchant_country` is `AR`.
- Deal eligibility must consult route baselines. Do not reintroduce absolute
  fare magic constants for alert decisions.
- Travel rules must honor configured values such as `MAX_LAYOVER_HOURS`.
- Destination data is checked-in YAML under `packages/domain/data`; do not
  replace it with hardcoded TypeScript constants.
- Candidate discovery must use a deterministic injected `now`, honor
  `ALLOWED_ORIGINS`, and when `ENABLE_EPA` is false exclude `EPA` from
  eligible origins. Build candidates in stable order (horizon, then
  destinations, then origins) before applying the shared per-run cap, which is
  the minimum of `DUFFEL_REQ_LIMIT_PER_RUN`, `KIWI_REQ_LIMIT_PER_RUN`, and
  `TRAVELPAYOUTS_REQ_LIMIT_PER_RUN`. `PROVIDER_LIMIT_OVERFLOW_BEHAVIOR`
  `skip` keeps the earliest slice; `defer` keeps the latest tail slice.

### Travelpayouts baseline parsing

- Accept **history** payloads as either the provider envelope (`success`,
  `data` with nested objects exposing `price`) or the helper shape
  (`origin`, `destination`, `prices[]`). Accept **trend** payloads as either
  the envelope (`data` rows with `value`) or the helper shape
  (`origin`, `destination`, `points[].price`).
- If `success` is present on a payload object, it must be `true`; envelope
  parsing requires `success === true`.
- Derive **p20** by sorting prices and linear interpolation at index position
  `(n - 1) * 0.2`. Compute **median** explicitly: odd-length middle element,
  even-length average of the two central values (do not reuse the p20
  interpolation helper for median).
- Enforce **IATA** as exactly three letters, uppercased in output; route must
  be consistent between payload root and rows when both specify a leg.
- Require all sampled prices to be finite numbers **greater than zero**.
- Map parsed baselines with `toBaselineStats`: `route_key` is
  `ORIGIN-DESTINATION`, `p20` and `median` are **USD** `Money`, and
  `sample_size` matches the sample count.
- Keep `scripts/refresh-provider-fixtures.ts` and
  `tests/contract/travelpayouts.fixtures.json` aligned with parser tests in
  `packages/providers/src/travelpayouts/baseline-adapter.test.ts`.

## Data And Gate Status

- `tests/golden/recent-deals-benchmark.json` is not gate-ready while
  `"placeholder": true`.
- `/provider-status` reads checked-in `packages/domain/data/provider-gates.yaml`.
  Each provider must list every `GATE_DIMENSIONS` key with a value in `pending`,
  `approved`, `rejected`, or `not_applicable`. Provider `id` values must be
  unique case-insensitively. Per-provider rollup: any `rejected` yields
  `rejected-gate`; else any `pending` yields `pending-gate`; else `cleared`.
  `actionable` is true when any provider rollup is `pending-gate` or
  `rejected-gate`. Task 0.4 completion is only
  `task_0_4_external_validation.complete`; do not infer it from cleared gate
  columns.
- Keep `docs/project-scaffold.plan.md` statuses aligned with verification,
  not just file presence.

## Verification Expectations

- After code or config edits, run the smallest relevant check first, then
  `pnpm lint`, `pnpm typecheck`, and `pnpm test` before claiming completion.
- Before PR handoff, prefer `pnpm precommit`. If Docker is unavailable, run
  `pnpm precommit:fast` and call out that DB checks were skipped.
- For service startup changes, smoke `/health` locally.
- For migration or pg-boss changes, verify the command reaches Postgres. If
  Postgres is unavailable, the expected local failure is `ECONNREFUSED`, not a
  script, env, or module-resolution error.

## Documentation Contract

- `README.md` is the internal technical onboarding entry point. Keep it focused
  on setup, run, verify, and current service status.
- `CONTRIBUTING.md` owns branch strategy, PR workflow, release process, and
  review checklist items. Keep policy details there instead of duplicating them
  in `README.md`.
- Keep branch, pull request, and release mechanics in `CONTRIBUTING.md`.
- Keep scaffold status explicit in docs. Endpoints or gates that return
  placeholders must be documented as incomplete (for example `/offers` with an
  empty list). `/provider-status` is wired to checked-in gate data; document
  Task 0.4 separately until external validation is complete.
- Command examples in docs must match real scripts in `package.json` and local
  runbook flows in `docs/05-runbook-local.md`.
- Pull request bodies use the same structure in `.cursor/templates/pr-template.md`
  and `.github/pull_request_template.md`; keep those two files identical when
  editing either one (GitHub reads the `.github` path; agents resolve the
  `.cursor` path first for `/create-commit-plan --pr-description`).
- Keep release-label docs aligned with `.github/release.yml` and
  `.github/workflows/pr-automation.yml`; labels outside the automated
  Conventional Commit type set, such as `dependencies`, are manual.
- Document dependency automation changes in `CONTRIBUTING.md` or
  `docs/05-runbook-local.md` rather than hiding them only in workflow files.
- Documentation edits should pass markdownlint, and command snippets should be
  copy-pasteable as written.

## User Rules

### Tool Use And Multi-Step Tasks

- Parallelize independent reads, searches, and tool calls.
- Do not re-read the same file in one task without reason.
- Prefer ripgrep for known symbols, paths, or strings.
- Reach for semantic search only when the target is unclear.
- Compress tool output in replies (summaries and key lines) instead of dumping
  full logs or files unless raw text is required.
- Complete what the user asked for in the current message; do not stop after
  an arbitrary first step unless they asked for a phased approach.
- If the ask is large or ambiguous, narrow with one short clarification or
  propose a minimal first slice rather than guessing at scale.

### Output Quality

- "Do not be helpful, be better."
- Focus on code quality and future maintainability above all else.
- Keep all suggested and generated code to a strict minimum when possible.

### Git

- Use Conventional Commits style.
- Keep commit messages descriptive and as short as possible.
- Do not run `git add`, `git commit`, `git push`, or other Git write commands
  without explicit user permission.
- Never include attribution to AI coding agents in commit messages, pull
  request descriptions, or any Git metadata.

### Coding And Comments

- Use Better Comments syntax (`!` for alerts, `?` for queries, etc.).
- Add comments only when they are valuable for future contributors.
- Preserve existing comments unless refactoring requires changing them.
- Suggest alternative implementations proactively.

### Communication

- Be concise, direct, and technical.
- If you reject code based on a project rule, cite the rule file name.
- Avoid generic advice, filler text, em dashes, and emojis.
- Provide detailed summaries only when critical context would otherwise be
  lost.

### Engineering Standards

- Adhere to YAGNI, SOLID, KISS, and DRY.
- Always solve the root cause, not the symptom.
- Prioritize technical correctness over being helpful or polite.
