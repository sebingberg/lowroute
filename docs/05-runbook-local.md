# Local Runbook

## Start Dependencies

```bash
docker compose up -d postgres
```

## Prepare Environment

```bash
cp .env.example .env
pnpm install
pnpm migrate:up
```

## Verify

```bash
pnpm typecheck
pnpm test
pnpm smoke:provider
```

## Start Service

```bash
pnpm --filter @lowroute/service dev
```
