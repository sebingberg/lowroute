# Local Runbook

## Start Dependencies

```bash
docker compose up -d postgres
```

## Prepare Environment

```bash
cp .env.example .env
pnpm install --frozen-lockfile
pnpm migrate:up
```

## Verify

Fast local loop without Docker-backed checks:

```bash
pnpm precommit:fast
```

Full local gate with Postgres-backed migration and queue smoke checks:

```bash
pnpm precommit
```

Useful individual checks:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm smoke:provider
```

## Start Service

```bash
pnpm --filter @lowroute/service dev
```

## Smoke Check

```bash
curl -s http://localhost:3000/health
```
