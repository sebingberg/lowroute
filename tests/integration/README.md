# Integration Tests

Pg-backed coverage for the persist -> select -> send-suppress chain
(`tests/integration/persist-select-send-suppress.test.ts`).

## Prerequisites

- Docker with a healthy `postgres` service.
- Migrations applied (`infra/migrations/0001_init.up.sql` creates `offers`,
  `route_baselines`, `sent_alerts`, and `probe_runs`).

## Run

```sh
docker compose up -d postgres
pnpm migrate:up
DATABASE_URL=postgres://postgres:postgres@localhost:5432/lowroute pnpm test:integration
```

The suite probes Postgres over TCP first and skips gracefully with a warning
when the database is unreachable, so `pnpm test:integration` stays green
without a database.
