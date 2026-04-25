# Architecture

## Stack

- Runtime: Node.js `>=24.0` (see root `engines` and `.nvmrc`).
- API: Hono.
- Validation: Zod.
- DB: PostgreSQL.
- Job queue: pg-boss.
- Logging: Pino.
- Tests: Vitest.

## Components

- `apps/service`: worker + API host.
- `packages/domain`: product rules and scoring logic.
- `packages/providers`: provider contracts and adapters.
- `packages/persistence`: DB and repositories.
- `packages/notifications`: Telegram notifier.
- `packages/config`: runtime configuration.
