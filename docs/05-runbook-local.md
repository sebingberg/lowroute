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

## Worker Pipeline

Starting the service also boots the pg-boss worker, which registers the
`lowroute.discover` -> `lowroute.fetch` -> `lowroute.score` ->
`lowroute.select` -> `lowroute.send` chain. Each boot enqueues one discovery
run immediately, then repeats on a schedule every
`WORKER_DISCOVERY_INTERVAL_MIN` (default `360` minutes). The interval must
map exactly to cron (`<60`, hourly multiples, or `1440`); anything else
fails worker startup loudly. The boot kickoff uses a stable pg-boss
singleton so concurrent boots enqueue one run. Run a single service
replica; multi-replica is untested. Failed jobs retry 5
times with backoff, then move to the `lowroute.dead-letter` queue.

Fetch builds real search requests but yields stub offers until
provider→domain normalization lands (live probes stay unfanned to protect
quota); selection still applies cooldown gating with empty baselines.

## Failure Drills

1. Run the service with Postgres stopped: the worker logs a connection
   refusal (`ECONNREFUSED`) but `/health` keeps serving.
2. Stop Postgres mid-run: failing jobs retry with backoff, then land in
   `lowroute.dead-letter`.
3. Restart Postgres and replay the dead letters into the failed step:

```bash
pnpm replay:dead-letter -- --queue lowroute.fetch --dry-run
pnpm replay:dead-letter -- --queue lowroute.fetch
```

Re-running a step re-fires downstream stages. Each dead-letter job records
its origin queue; replay requires `--queue` to match and refuses mixed
contents, so replay each origin separately. The send stage stays
idempotent through `sent_alerts` cooldown suppression. Replay itself is
at-least-once: a crash between requeue and dead-letter cleanup replays the
job again on the next run. `--dry-run` only reads queue size and takes no
job leases.
