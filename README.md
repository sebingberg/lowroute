# Lowroute

[![CI](https://github.com/sebingberg/lowroute/actions/workflows/ci.yml/badge.svg)](https://github.com/sebingberg/lowroute/actions/workflows/ci.yml)
[![Node.js >=24.0](https://img.shields.io/badge/node-%3E%3D24.0.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![pnpm 10.10.0](https://img.shields.io/badge/pnpm-10.10.0-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)

Lowroute is an internal MVP service that discovers economy fare deals from
Buenos Aires origins and prepares strict, rule-driven Telegram alert flows.

## Table of Contents

- [Technical Overview](#technical-overview)
- [Repository Layout](#repository-layout)
- [Prerequisites](#prerequisites)
- [Quickstart](#quickstart)
- [Run and Verify](#run-and-verify)
- [Environment Variables](#environment-variables)
- [HTTP Endpoints](#http-endpoints)
- [Database and Migrations](#database-and-migrations)
- [Contributing](#contributing)
- [Troubleshooting](#troubleshooting)

## Technical Overview

- Runtime: Node.js `>=24.0`, TypeScript (ESM), pnpm workspaces.
- API host: Hono in `apps/service`.
- Core packages: `@lowroute/config`, `@lowroute/domain`,
  `@lowroute/providers`, `@lowroute/notifications`, `@lowroute/persistence`.
- Data + infra: PostgreSQL, migrations in `infra/migrations`, queue checks via
  `pg-boss`.
- Verification stack: Vitest, Biome, markdownlint, Lefthook.
- Dependency maintenance: Dependabot checks npm and GitHub Actions weekly;
  GitHub Dependabot alerts are the source of truth for security advisory
  closure.

## Repository Layout

```text
.
├── apps/
│   └── service/           # Hono API + worker entrypoint
├── packages/
│   ├── config/            # Env parsing and runtime config
│   ├── domain/            # Pricing, scoring, eligibility rules
│   ├── notifications/     # Alert rendering and Telegram integration
│   ├── persistence/       # PostgreSQL access and repositories
│   └── providers/         # Provider contracts and adapters
├── infra/
│   └── migrations/        # node-pg-migrate files
├── docs/                  # Product + architecture + runbook docs
└── scripts/               # Precommit and local utility scripts
```

## Prerequisites

- Node.js `>=24.0` (see `.nvmrc`).
- `pnpm` `10.10.0`.
- Docker (for local PostgreSQL via `docker compose`).

## Quickstart

1. Install dependencies.

   ```bash
   pnpm install --frozen-lockfile
   ```

2. Copy the environment template.

   ```bash
   cp .env.example .env
   ```

3. Start local PostgreSQL.

   ```bash
   docker compose up -d postgres
   ```

4. Apply migrations.

   ```bash
   pnpm migrate:up
   ```

5. Start the service (also boots the pg-boss worker chain).

   ```bash
   pnpm --filter @lowroute/service dev
   ```

6. Smoke check health.

   ```bash
   curl -s http://localhost:3000/health
   ```

## Run and Verify

- Fast local gate (no Docker requirement).

  ```bash
  pnpm precommit:fast
  ```

- Full local gate (includes Docker-backed checks).

  ```bash
  pnpm precommit
  ```

- Individual commands.

  ```bash
  pnpm install --frozen-lockfile
  pnpm lint
  pnpm typecheck
  pnpm test
  pnpm build
  pnpm smoke:provider
  ```

Lefthook hooks are installed by `pnpm install`. If needed:

```bash
pnpm hooks:install
```

## Environment Variables

Use `.env.example` as the source of truth for local setup.

- `DATABASE_URL`: PostgreSQL connection string used by migrations and runtime.
- `TELEGRAM_ALERTS_ENABLED`: global kill switch for Telegram sending, defaults
  to `false`.
- `ALERT_DRY_RUN`: when `true`, renders/logs alert payloads and must not send
  Telegram messages.
- `ALLOWED_ORIGINS`: comma-separated IATA origins, default `EZE,AEP`.
- `ENABLE_EPA`: optional enablement gate for `EPA` origin.
- `MAX_LAYOVER_HOURS`: travel-rule constraint used in candidate filtering.
- `WORKER_DISCOVERY_INTERVAL_MIN`: minutes between discovery runs, default
  `360`.

## HTTP Endpoints

Service routes are defined in `apps/service/src/index.ts`.

- `GET /health`: runtime health payload (`status`, `service`, `now_utc`).
- `GET /offers`: scaffold payload (`offers: []`, `count: 0`).
- `GET /alerts`: scaffold payload (`alerts: []`, `count: 0`).
- `GET /provider-status`: reads `packages/domain/data/provider-gates.yaml`
  (`actionable` when documentation gates are pending/rejected). Task 0.4
  external validation is reported separately in the JSON payload and remains
  incomplete until explicitly marked in that file.

## Database and Migrations

- Apply migrations:

  ```bash
  pnpm migrate:up
  ```

- Roll back last migration:

  ```bash
  pnpm migrate:down
  ```

The migration scripts rely on `DATABASE_URL` from your environment.

## Dependency Maintenance

Dependabot is configured in `.github/dependabot.yml` for weekly npm and
GitHub Actions updates. For dependency PRs, keep `pnpm-lock.yaml` committed,
verify with `pnpm install --frozen-lockfile`, and use `pnpm audit` only as an
npm advisory cross-check. GitHub Dependabot alerts use GitHub Security
Advisories and may close only after GitHub rescans the updated manifest and
lockfile.

## Contributing

Use `CONTRIBUTING.md` for contributor workflow, verification expectations,
and project guardrails. Release tagging and GitHub Release automation are
documented in `docs/10-release-process.md`.

## Troubleshooting

- `pnpm migrate:up` fails with connection error:
  ensure `docker compose up -d postgres` is running and `DATABASE_URL` points
  to `localhost:5432/lowroute`.
- Git hooks not firing:
  run `pnpm hooks:install` and confirm `.git/hooks` contains Lefthook scripts.
- `pnpm precommit` fails on DB checks without Docker:
  run `pnpm precommit:fast` for non-DB iteration, then rerun full precommit
  when Docker is available.
