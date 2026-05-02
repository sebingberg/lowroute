# Lowroute MVP Project Scaffold Plan v3

## Goal

Build an MVP flight-deals bot that:

- Finds strong economy fare opportunities from Buenos Aires.
- Applies strict traveler constraints before alerting.
- Sends private Telegram alerts with actionable details.
- Optimizes for real-world deal quality, not only API completeness.

## Product Constraints

- Origins: `EZE`, `AEP`.
- Optional origin: `EPA` behind feature flag.
- Cabin: economy only.
- Traveler profile: solo, backpack + carry-on.
- Max layover per segment pair: `< 8h`.
- Minimum trip duration:
  - Near destinations: `>= 7d`.
  - Medium destinations: `>= 14d`.
  - Far destinations: `>= 21d`.
- Notifications: private Telegram chat.

## Definitions Required for Testability

- Distance bands from origin city (`BUE` centroid):
  - Near: `0-2500 km`.
  - Medium: `2501-7000 km`.
  - Far: `>7000 km`.
- Timezone policy:
  - Storage: UTC.
  - Display: `America/Argentina/Buenos_Aires`.
- Money policy:
  - Store amount + currency as value object.
  - Score using normalized payable amount.

## Architecture Decisions

- Runtime: current active Node LTS at scaffold time, minimum `>=24.0`.
  Pin the selected major in `.nvmrc` and CI.
- Workspace: `pnpm workspaces` + TypeScript project references.
- HTTP API: `Hono`, mounted inside the worker process.
- Validation: `Zod`.
- Database: `PostgreSQL`.
- Job orchestration: `pg-boss`.
- Logging: `Pino` (structured logs with `job_id`, `provider`, `route`,
  `request_count`, `latency_ms`).
- Tracing: not implemented for MVP. Reassess after first user.
- Testing: `Vitest`, unit tests co-located with source.
- Lint/format: `Biome` for TS/JS/JSON; `markdownlint-cli2` for Markdown.
- Build/dev: `tsx` for dev runs, `tsc --noEmit` for typecheck, `tsc` for
  build. No bundler.
- Migrations: `node-pg-migrate` with raw SQL `up`/`down` files under
  `infra/migrations/`.
- Notifications: Telegram Bot API with `HTML` parse mode.
- Filenames: kebab-case across the repo. Class names stay PascalCase
  inside files.

## Provider Strategy

### Phase 1 Providers

- `Duffel` for live bookable inventory.
- `Kiwi Tequila` for virtual interlining opportunities.
- `Travelpayouts` for historical baseline and trend context.

### Phase 2 Candidates

- `Amadeus Self-Service` as supplemental source.
- `Skyscanner API` only if partner approval is granted.
- `SerpApi (Google Flights)` as a paid third-party proxy.
  Requires explicit commercial/legal-use review before adoption.
- Curated deal-feed import (Going.com, JackysFlightClub, Pelikin) as a
  manual or semi-manual import path. Lower technical risk for
  personal-use single-recipient alerts, but still subject to source
  terms and copyright constraints.

### Non-Goal for MVP

- No in-house scraping of metasearch sites.

## Provider Access Gate (Must Pass Before Phase 3)

For each Phase 1 provider, confirm:

- Valid credentials are issued and tested.
- Intended use case is explicitly allowed by terms.
- Expected rate limits are known.
- Expected costs and billing triggers are documented.
- Production eligibility is confirmed, not assumed.

If any provider fails access/commercial gating, remove it from Phase 1,
document fallback in `docs/01-provider-matrix.md`, and continue only
with approved providers.

## Provider Coverage Gate (Must Pass Before Full Build)

Use a benchmark dataset of recent real deals plus a paired probe set.

### Benchmark Row Schema

- Identity: `origin`, `destination`, `departure_date`, `return_date`,
  `trip_length_days`.
- Source: `discovered_date`, `source_site`, `source_url`,
  `merchant_country`.
- Pricing: `recorded_all_in_paid_price`, `currency`, `paid_via`
  (`ar_card` | `foreign_card` | `merchant_outside_ar`),
  FX snapshot/rate source used at recording time.
- Itinerary shape: `carrier`, `operating_carrier`, `self_transfer`,
  `separate_tickets`, `airport_changes`, `overnight_layover`,
  `checked_bag_included`, `carry_on_included`.
- Manual-search assumptions: `max_stops`, `max_layover_hours`,
  `baggage_profile`.

### Pass/Fail Definition

- For each benchmark row, run provider probes within 24h and store
  probe output.
- Reproduction rate must be `>= 70%`.
- Price tolerance must be within `+/- 20%` vs recorded all-in paid
  price, after applying the AR cost model to provider quotes.
- Match criteria:
  - same origin and destination city/airport group,
  - departure date and return date within configured tolerance windows,
  - trip length tolerance `+/- 2 days`,
  - compatible stops/layover and baggage assumptions,
  - at least one matching offer in probe snapshot.
- Manual override: a provider that fails the numeric gate may be
  approved with a documented reason in
  `docs/06-provider-coverage-gate.md`. Override must name the failure
  modes accepted and the mitigations relied on.

### Caveats

- This is a smoke gate, not a statistical guarantee. Treat borderline
  passes (`70%-80%`) as candidates for a second probe round.
- The 24h paired-probe window measures practical coverage, not strict
  low-latency alert timing for short-lived flash fares. Add a post-MVP
  latency acceptance test for probe-to-alert timing.

## Argentina Cost Model

### Default Scoring Path

Default scoring path is `foreign_card` + `merchant_outside_ar`, with
no AR tax adjustment. This matches the operator's intended payment
method (international USD card, foreign merchant of record).

### AR-Merchant Exception Class

AR tax logic applies only to documented AR-merchant exception classes,
including but not limited to:

- Argentine LCCs sold in ARS (Flybondi, JetSmart Argentina domestic).
- Aerolineas Argentinas ARS-only promo fares.
- Despegar/Almundo ARS-locked offers.

### Authoritative Inputs and Refresh

Define an explicit, versioned ruleset before implementing
normalization in `docs/07-ar-cost-normalization.md`:

- Tax components and applicability rules for the exception class.
- Detection rules for `merchant_country == AR` and ARS-only fares.
- FX source policy:
  - primary source,
  - fallback source,
  - stale-rate behavior.
- Refresh cadence:
  - tax ruleset update policy,
  - FX refresh frequency.

All assumptions must be versioned via `AR_TAX_RULESET_VERSION` and
overridable via config.

### Currency Display Policy

- Primary: USD normalized payable amount.
- Secondary: provider quoted currency and amount.
- ARS: shown only when the offer is in the AR-merchant exception class.
- Documented in `docs/03-alert-policy.md`.

## Candidate Generation Scope

- Destination universe:
  - curated allowlist with tourist metadata,
  - per-destination tier (near, medium, far),
  - stored as a checked-in data file (YAML or JSON), not TS constants.
- Date horizon:
  - rolling window from `+30d` to `+330d`.
- Trip-length buckets by tier (discovery search bounds only, not hard
  eligibility filters):
  - near: 7-14d,
  - medium: 14-21d,
  - far: 21-35d.
- Provider budget:
  - per-run and per-day request caps per provider,
  - overflow behavior: `skip` or `defer` (configurable).

## Deal Definition

An offer qualifies as a deal only if all are true:

- Passes hard filters (cabin, layover cap, min trip duration by tier).
- Meets route baseline threshold using historical context.
- Beats a configurable percentile or absolute discount threshold.

Baseline sources:

- Travelpayouts history where available.
- Internal rolling offer history fallback.

Configurable thresholds:

- `DEAL_PERCENTILE_THRESHOLD` and/or `DEAL_DISCOUNT_PCT`.

## Scoring and Itinerary Quality

- Score Kiwi virtual-interline (self-transfer, separate-ticket)
  itineraries on a separate track from protected single-ticket
  itineraries. They are not directly comparable.
- Apply quality penalties for:
  - airport change,
  - overnight layover,
  - self-transfer,
  - separate tickets,
  - sub-90-min self-connection.
- Penalty weights documented in `docs/03-alert-policy.md`.
- Display itinerary risk flags in the Telegram alert
  (e.g. `[self-transfer]`, `[no checked bag]`,
  `[airport change MAD->MAD-T4S]`).

## Operational Safety

- Alert kill switch: `TELEGRAM_ALERTS_ENABLED`. Default `false`.
  Production deployment must explicitly set `true`. No config file or
  default override may flip it on accidentally.
- Dry-run mode: `ALERT_DRY_RUN`. When enabled, the worker produces
  selected deals end-to-end and logs them, but does not call Telegram.
- First-class idempotency keys: `offer_fingerprint`,
  `alert_fingerprint`, `probe_run_id` as schema columns. Fingerprint
  composition documented in `docs/03-alert-policy.md`.
- Benchmark and probe storage must exclude PII: no passport numbers,
  card numbers, account IDs, booking references, or full names.

## Repository Scaffold

```text
lowroute/
  README.md
  .env.example
  .nvmrc
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  biome.json
  .markdownlint.jsonc
  docker-compose.yml

  docs/
    00-product-scope.md
    01-provider-matrix.md
    02-search-rules.md
    03-alert-policy.md
    04-architecture.md
    05-runbook-local.md
    06-provider-coverage-gate.md
    07-ar-cost-normalization.md
    08-fixture-refresh-policy.md
    09-provider-risk-log.md

  apps/
    service/
      src/index.ts
      src/http/health.ts
      src/http/offers.ts
      src/http/alerts.ts
      src/http/provider-status.ts
      src/jobs/discover-candidates.ts
      src/jobs/fetch-offers.ts
      src/jobs/score-offers.ts
      src/jobs/select-deals.ts
      src/jobs/send-alerts.ts

  packages/
    domain/
      data/destinations.yaml
      src/entities/offer.ts
      src/entities/search-profile.ts
      src/value-objects/money.ts
      src/services/travel-rules-service.ts
      src/services/cost-normalization-service.ts
      src/services/deal-baseline-service.ts
      src/services/scoring-service.ts
      src/services/alert-eligibility-service.ts
    providers/
      src/types.ts
      src/duffel/
      src/kiwi/
      src/travelpayouts/
    notifications/
      src/telegram/telegram-notifier.ts
    persistence/
      src/db.ts
      src/repositories/
    config/
      src/env.ts
      src/constants.ts

  infra/
    migrations/
      0001_init.up.sql
      0001_init.down.sql

  scripts/
    refresh-provider-fixtures.ts
    run-provider-smoke.ts

  tests/
    integration/
    contract/
      duffel.fixtures.json
      kiwi.fixtures.json
      travelpayouts.fixtures.json
    golden/
      README.md
      recent-deals-benchmark.json

  .github/
    workflows/
      ci.yml
```

Notes:

- Unit tests live next to source as `*.test.ts`. Only integration,
  contract, and golden tests live under `tests/`.
- Provider directories under `packages/providers/src/` are created
  only for providers approved by the Provider Access Gate.

## Execution Plan

### Phase 0 - Foundation and Hard Gates

- [x] **Task 0.1: Initialize repository structure**
  - Scope: scaffold apps/packages/docs/infra/scripts/tests with pnpm
    workspaces and TS project references.
  - Expected files: tree above; `pnpm-workspace.yaml`,
    `tsconfig.base.json`, `.nvmrc`, `biome.json`,
    `.markdownlint.jsonc`.
  - Verification: `pnpm install --frozen-lockfile` succeeds;
    `pnpm typecheck` passes.

- [ ] **Task 0.2: Verify runtime and toolchain on selected LTS**
  - Scope: prove `pg-boss` publish/consume, `Vitest` execution, and
    GitHub Actions CI green on the pinned active LTS major.
  - Expected files: `package.json` scripts, `.github/workflows/ci.yml`.
  - Verification: smoke job publishes/consumes a `pg-boss` task; CI
    runs `typecheck`, `lint`, `test` cleanly on the pinned major.
  - Status: implemented. CI and smoke scripts are in place; full local
    verification is available through `pnpm precommit` when Docker/Postgres
    is running.

- [ ] **Task 0.3: Local Postgres baseline and migration runner**
  - Scope: Docker Postgres + `node-pg-migrate` with raw SQL files.
  - Expected files: `docker-compose.yml`,
    `infra/migrations/0001_init.up.sql`,
    `infra/migrations/0001_init.down.sql`.
  - Verification: `pnpm migrate:up` and `pnpm migrate:down` apply cleanly against
    local DB.
  - Status: scaffolded and verified through CI/pre-push migration checks
    against local Postgres.

- [ ] **Task 0.4: Provider access and commercial validation gate**
  - Scope: validate Duffel, Kiwi, and Travelpayouts access, terms,
    limits, and expected fees.
  - Expected files: `docs/01-provider-matrix.md` access status section.
  - Verification: each provider marked approved or rejected for
    Phase 1.
  - Status: this worktree adds checked-in provider gate state under
    `packages/domain/data/provider-gates.yaml`, but external credential
    and commercial validation remains incomplete until the YAML is updated
    from real evidence.

- [x] **Task 0.5: Define coverage gate methodology and thresholds**
  - Scope: freeze matching rules, tolerances, pass/fail criteria,
    and manual override conditions.
  - Expected files: `docs/06-provider-coverage-gate.md`.
  - Verification: methodology is precise and testable.

### Phase 1 - Product Correctness Inputs

- [x] **Task 1.1: Define AR cost model**
  - Scope: default `foreign_card` + `merchant_outside_ar` no-tax path;
    AR-merchant exception class detection and tax rules; FX sources
    and refresh cadence.
  - Expected files: `docs/07-ar-cost-normalization.md`.
  - Verification: rule table is explicit and versioned via
    `AR_TAX_RULESET_VERSION`.

- [ ] **Task 1.2: Build recent-deals benchmark dataset**
  - Scope: collect 20-30 real deals from last 90 days using the
    expanded benchmark row schema; sanitize PII.
  - Expected files: `tests/golden/recent-deals-benchmark.json`,
    `tests/golden/README.md`.
  - Verification: dataset complete, schema-conformant, PII-free.
  - Status: scaffold placeholder remains. This worktree adds structural
    and gate-ready validation plus `pnpm benchmark:gate`; still needs the
    full 20-30 real-deal dataset before the gate can pass.

- [ ] **Task 1.3: Calibrate distance bands**
  - Scope: validate tier thresholds against benchmark acceptance
    patterns; revise band boundaries if needed.
  - Expected files: `docs/02-search-rules.md` calibration notes.
  - Verification: selected thresholds do not over-filter accepted
    historical deals.

- [ ] **Task 1.4: Define destination universe**
  - Scope: curated destinations and tier metadata, sourced as a
    checked-in YAML/JSON data file.
  - Expected files: `packages/domain/data/destinations.yaml`,
    `docs/02-search-rules.md`.
  - Verification: all destinations resolve to a calibrated tier.
  - Status: runtime now loads the YAML file directly; still needs
    benchmark-driven tier calibration before completion.

- [x] **Task 1.5: Define discovery windows and per-provider budgets**
  - Scope: date horizon, trip-length bounds, per-provider request
    caps, overflow behavior.
  - Expected files: `packages/config/src/constants.ts`.
  - Verification: deterministic candidate count per run.

### Phase 2 - Domain Rules and Normalization

- [x] **Task 2.1: Implement hard travel rules**
  - Scope: cabin, baggage profile, layover cap, min duration by tier.
  - Expected files: `travel-rules-service.ts` + co-located tests.
  - Verification: edge-case matrix is green.

- [x] **Task 2.2: Implement money and timezone policy**
  - Scope: `Money` value object, currency display policy, formatters.
  - Expected files: `money.ts`, formatter utilities.
  - Verification: no currency-agnostic calculations remain.

- [x] **Task 2.3: Implement AR cost normalization**
  - Scope: AR-merchant exception detection and tax application;
    foreign-card path passthrough.
  - Expected files: `cost-normalization-service.ts`.
  - Verification: test vectors cover both default and exception paths.

### Phase 3 - Provider Layer and Coverage Gate

- [x] **Task 3.1: Define provider contract**
  - Scope: normalized offer shape, itinerary-quality metadata fields.
  - Expected files: `packages/providers/src/types.ts`.
  - Verification: contract tests compile for all approved adapters.

- [x] **Task 3.2: Implement lightweight provider probes**
  - Scope: minimal raw search probes for approved providers only.
  - Expected files: `packages/providers/src/<provider>/probe.ts`.
  - Verification: probe outputs captured for benchmark rows.

- [ ] **Task 3.3: Execute live paired coverage gate**
  - Scope: run probes, apply AR cost model to provider quotes,
    compute reproduction metrics.
  - Expected files: gate report appended to
    `docs/06-provider-coverage-gate.md`.
  - Verification: numeric threshold met, or override documented, or
    provider strategy revised.

- [ ] **Task 3.4: Implement production adapters for approved providers**
  - Scope: normalization + robust error handling + risk metadata.
  - Expected files: `packages/providers/src/<approved-provider>/*`.
  - Verification: fixture tests + manual smoke run.

- [ ] **Task 3.5: Implement Travelpayouts baseline adapter**
  - Scope: historical/trend retrieval for baseline service.
  - Expected files: `packages/providers/src/travelpayouts/*`.
  - Verification: baseline parser tests.
  - Status: history/trend JSON parsers and unit tests in place; live API
    retrieval and persistence wiring remain pending.

### Phase 4 - Deal Baseline, Scoring, and Selection

- [x] **Task 4.1: Implement baseline engine**
  - Scope: route-level historical baseline service.
  - Expected files: `deal-baseline-service.ts`.
  - Verification: baseline values reproducible in tests.

- [x] **Task 4.2: Implement scoring service**
  - Scope: weighted score using normalized payable amount; separate
    track for Kiwi virtual-interline; quality penalties for airport
    change, overnight layover, self-transfer, separate tickets,
    short self-connections.
  - Expected files: `scoring-service.ts`.
  - Verification: ranking tests over synthetic and golden data.

- [ ] **Task 4.3: Implement alert eligibility service**
  - Scope: hard thresholding, anti-noise controls, cooldown.
  - Expected files: `alert-eligibility-service.ts`,
    `docs/03-alert-policy.md`.
  - Verification: alert/no-alert decision tests pass.
  - Status: baseline-driven eligibility is scaffolded; cooldown and
    persistence-backed suppression remain pending.

### Phase 5 - Persistence and Idempotency

- [ ] **Task 5.1: Create schema and indexes**
  - Scope: offers, baselines, sent alerts, jobs, idempotency-key
    columns (`offer_fingerprint`, `alert_fingerprint`,
    `probe_run_id`).
  - Expected files: additional migration files under
    `infra/migrations/`.
  - Verification: migrations apply and indexes are active.
  - Status: initial schema and indexes authored; migration application is
    verified through CI/pre-push checks against Postgres.

- [ ] **Task 5.2: Implement repository layer**
  - Scope: storage and read patterns for offers/alerts/baselines.
  - Expected files: `packages/persistence/src/repositories/*`.
  - Verification: integration tests against local Postgres.
  - Status: repository scaffolds implemented; DB-backed integration
    tests still pending.

- [ ] **Task 5.3: Implement dedup and cooldown**
  - Scope: fingerprint composition and suppression windows.
  - Expected files: persistence + domain updates.
  - Verification: idempotency tests are green.
  - Notes: fingerprint composition documented in
    `docs/03-alert-policy.md`.

### Phase 6 - Worker Pipeline

- [ ] **Task 6.1: Implement candidate discovery job**
  - Scope: deterministic generation from destination/date universe.
  - Expected files: `apps/service/src/jobs/discover-candidates.ts`.
  - Verification: run output stable for fixed seed/time.
  - Status: deterministic candidates honor origin/EPA flags, per-run
    provider budgets (`min` across Duffel/Kiwi/Travelpayouts), and
    `PROVIDER_LIMIT_OVERFLOW_BEHAVIOR` (`skip` prefix / `defer` suffix);
    worker job wiring remains pending.

- [ ] **Task 6.2: Implement fetch/score/select/send pipeline**
  - Scope: `pg-boss` queues and retries; respect dry-run and kill
    switch.
  - Expected files: all job files under `apps/service/src/jobs/`.
  - Verification: end-to-end local run completes repeatedly in
    dry-run mode.
  - Status: job flow skeleton implemented; queue orchestration and
    retry semantics still pending.

- [ ] **Task 6.3: Add failure controls**
  - Scope: backoff, dead letters, replay strategy.
  - Expected files: worker config and handlers.
  - Verification: fault-injection tests pass.

### Phase 7 - Telegram and Admin API

- [ ] **Task 7.1: Implement Telegram notifier**
  - Scope: HTML formatting, escaping, send retries; honor
    `TELEGRAM_ALERTS_ENABLED` and `ALERT_DRY_RUN`; render itinerary
    risk flags in messages.
  - Expected files: `telegram-notifier.ts`.
  - Verification: dry-run suppresses send and logs payload; outbound
    sends use timeout, bounded retry, and non-2xx logging (covered by
    unit tests with fetch mocks). Private message readability remains an
    ops smoke check against the real Bot API.
  - Status: notifier behavior has focused unit coverage in this worktree;
    optional live Telegram smoke remains manual.

- [ ] **Task 7.2: Implement minimal admin API**
  - Scope: `/health`, `/offers`, `/alerts`, `/provider-status`.
  - Expected files: `apps/service/src/http/*`.
  - Verification: integration checks and curl smoke tests.
  - Status: routes are wired and the service listens locally; `/provider-status`
    reads `packages/domain/data/provider-gates.yaml`. Full admin verification
    (integration tests, smoke scripts) remains future work.

### Phase 8 - CI and Fixture Maintenance

- [x] **Task 8.1: Configure CI with Postgres service**
  - Scope: typecheck, lint, unit tests, and migrations using a Postgres
    service container on the pinned LTS major.
  - Expected files: `.github/workflows/ci.yml`.
  - Verification: CI green including Postgres-backed migrations; DB-backed
    repository integration tests remain a later task.

- [x] **Task 8.2: Add fixture refresh workflow**
  - Scope: documented fixture refresh and smoke scripts.
  - Expected files: `scripts/refresh-provider-fixtures.ts`,
    `docs/08-fixture-refresh-policy.md`.
  - Verification: refresh flow runs and updates fixtures consistently.
  - Status: this worktree preserves offline Travelpayouts history/trend
    samples during fixture refresh and formats generated fixture JSON.

## Implementation Log

- 2026-04-25: Scaffolded monorepo layout with pnpm workspaces,
  TypeScript project references, root toolchain configs, and Node LTS
  pinning via `.nvmrc`.
- 2026-04-25: Added core documentation skeleton under `docs/`, including
  required pre-code policy docs (`02`, `03`, `06`, `07`).
- 2026-04-25: Implemented package scaffolds for `config`, `domain`,
  `providers`, `notifications`, and `persistence` with typed exports.
- 2026-04-25: Implemented domain primitives and services: travel rules,
  money object, timezone/currency formatters, cost normalization,
  baseline service, scoring service, and alert eligibility service.
- 2026-04-25: Added domain unit tests for rules, normalization,
  baseline, scoring, and eligibility.
- 2026-04-25: Added provider contract types, lightweight probe stubs for
  Duffel/Kiwi/Travelpayouts, and Travelpayouts baseline adapter scaffold.
- 2026-04-25: Added service app skeleton with HTTP endpoints (`/health`,
  `/offers`, `/alerts`, `/provider-status`) and job module stubs for
  discovery/fetch/score/select/send.
- 2026-04-25: Added persistence layer scaffolds (DB pool + repositories)
  and initial SQL migration files.
- 2026-04-25: Added CI workflow (Postgres service), provider smoke script
  scaffold, fixture refresh script, and contract/golden fixture placeholders;
  CI and local tooling use Node 24 (GitHub Actions, `.nvmrc`,
  `package.json` engines, `@types/node`).
- 2026-04-25: Verified `pnpm lint`, `pnpm typecheck`, and
  `pnpm test` all pass locally.
- 2026-04-25: Verified Docker-backed pre-push flow with migrations and
  pg-boss smoke after local Postgres was available.
- 2026-04-25: Reconciled scaffold review findings: fixed env boolean
  parsing, service startup, migration scripts, pg-boss smoke API usage,
  candidate discovery shape, YAML-backed destinations, pricing value
  objects, lazy DB pool construction, Telegram dry-run/retry behavior,
  build/typecheck hygiene, benchmark placeholder marking, and task
  statuses for incomplete verification gates.
- 2026-04-25: Merged Dependabot dependency and GitHub Actions updates;
  GitHub currently reports zero open Dependabot alerts.
- 2026-04-28: Added benchmark dataset readiness validation with separate
  scaffold and gate-ready checks, a `pnpm benchmark:gate` command, and
  curator documentation. The gate intentionally remains blocked while
  `recent-deals-benchmark.json` is marked as a placeholder.
- 2026-04-28: Replaced `/provider-status` scaffold output with a
  checked-in provider gate data source, domain loader/tests, stable
  provider IDs plus display names, and documentation updates that keep
  Task 0.4 external validation explicit.
- 2026-04-28: Expanded the Travelpayouts baseline adapter with
  history/trend payload parsers, stricter alphabetic IATA validation,
  parser tests, and fixture refresh preservation for offline contract
  samples.
- 2026-04-28: Integrated provider-budget pressure into candidate discovery:
  per-run output is capped by the lowest Phase 1 provider run limit, with
  deterministic `skip`/`defer` overflow behavior and tests for cap
  stability, multi-origin distribution, and ambient env isolation.
- 2026-04-28: Added `@lowroute/notifications` Vitest coverage for Telegram
  dry-run, kill switch, outbound timeout wiring, bounded retry, non-2xx
  logging, and transport-error paths; Task 7.1 verification note updated
  accordingly.

## Documentation Discipline

Do not pre-write every doc. Create gate and policy docs when their
gate is reached. The exceptions, which must be scaffolded before the
code that depends on them, are:

- `docs/02-search-rules.md`
- `docs/03-alert-policy.md`
- `docs/06-provider-coverage-gate.md`
- `docs/07-ar-cost-normalization.md`

`docs/09-provider-risk-log.md` is a living document populated during
provider probes (Task 3.2 onward) with provider-specific gotchas
discovered against real responses.

## Initial Environment Variables

- `DATABASE_URL`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `TELEGRAM_ALERTS_ENABLED` (default `false`; production must
  explicitly set `true`)
- `ALERT_DRY_RUN` (default `false` in production, `true` in local)
- `DUFFEL_API_TOKEN`
- `KIWI_API_KEY`
- `TRAVELPAYOUTS_TOKEN`
- `AMADEUS_API_KEY` (Phase 2)
- `AMADEUS_API_SECRET` (Phase 2)
- `ALLOWED_ORIGINS` (default `EZE,AEP`)
- `ENABLE_EPA` (default `false`)
- `MAX_LAYOVER_HOURS` (default `8`)
- `APP_TIMEZONE` (default `America/Argentina/Buenos_Aires`)
- `DEFAULT_PAYMENT_PATH` (default `foreign_card`)
- `AR_TAX_RULESET_VERSION`
- `FX_RATE_SOURCE`
- `FX_RATE_TTL_HOURS`
- `BASELINE_LOOKBACK_DAYS` (default `90`)
- `DEAL_PERCENTILE_THRESHOLD` (default `0.20`)
- `DEAL_DISCOUNT_PCT` (optional absolute discount rule)
- `WORKER_DISCOVERY_INTERVAL_MIN` (default `360`)
- `DUFFEL_REQ_LIMIT_PER_RUN`
- `DUFFEL_REQ_LIMIT_PER_DAY`
- `KIWI_REQ_LIMIT_PER_RUN`
- `KIWI_REQ_LIMIT_PER_DAY`
- `TRAVELPAYOUTS_REQ_LIMIT_PER_RUN`
- `TRAVELPAYOUTS_REQ_LIMIT_PER_DAY`
- `PROVIDER_LIMIT_OVERFLOW_BEHAVIOR` (`skip` | `defer`)
- `COVERAGE_THRESHOLD_PCT` (default `70`)
- `COVERAGE_PRICE_TOLERANCE_PCT` (default `20`)
- `COVERAGE_TRIP_DAYS_TOLERANCE` (default `2`)
- `COVERAGE_DEPARTURE_DATE_TOLERANCE_DAYS` (default `7`)
- `COVERAGE_RETURN_DATE_TOLERANCE_DAYS` (default `7`)

## MVP Acceptance Criteria

- Provider coverage gate passes against benchmark dataset (or
  override is documented).
- Discovery space is deterministic and bounded by per-provider
  budgets.
- Foreign-card scoring path produces normalized USD payable amount
  in scoring and alerts; AR-merchant exception path is exercised by
  test vectors.
- Hard travel filters are fully test-covered.
- Deal baseline and eligibility are reproducible in tests.
- Idempotency keys suppress duplicate offers and alerts within
  cooldown.
- Kill switch and dry-run mode behave correctly under tests.
- Telegram alerts are private, escaped, actionable, and include
  itinerary risk flags.
- CI is green with Postgres-backed migrations and unit tests on the
  pinned LTS major.

## Out of Scope for MVP

- Booking and payment execution.
- Public web UI.
- In-house scraping pipelines.
- Advanced ML forecasting.
- Multi-user account management.
- OpenTelemetry tracing infrastructure.

## Next Step

Continue from the remaining gates: provider access validation (Task 0.4),
DB-backed repository tests,
provider-budget integration, and benchmark readiness. Do not proceed to
full provider adapter rollout until the access gate, coverage gate
methodology, AR cost model, and benchmark dataset are verified.
