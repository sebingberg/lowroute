# Fixture Refresh Policy

## Contract Fixtures

- Stored under `tests/contract/`.
- Refreshed using `pnpm refresh:fixtures`.
- Must redact secrets before commit.

## Refresh Triggers

- Provider response shape changes.
- New risk flags or fields added.
- Quarterly maintenance refresh.

## Validation

- Run `pnpm test` after refresh.
- Update fixture metadata timestamps.
