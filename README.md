# Lowroute

Lowroute is an MVP flight-deals bot focused on high-quality economy fare
opportunities from Buenos Aires.

## Prerequisites

- Node.js `>=22.12` (see `.nvmrc`)
- `pnpm`
- Docker (for local Postgres)

## Local Setup

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Start Postgres:

   ```bash
   docker compose up -d postgres
   ```

3. Copy environment template:

   ```bash
   cp .env.example .env
   ```

4. Run migrations:

   ```bash
   pnpm migrate:up
   ```

5. Verify workspace:

   ```bash
   pnpm typecheck
   pnpm test
   ```

## Commands

- `pnpm typecheck` - TypeScript typechecking.
- `pnpm lint` - Biome + markdownlint checks.
- `pnpm test` - Vitest suites across workspace.
- `pnpm migrate:up` / `pnpm migrate:down` - DB migrations.
- `pnpm smoke:provider` - pg-boss publish/fetch smoke check.
- `pnpm refresh:fixtures` - Refresh fixture metadata.
