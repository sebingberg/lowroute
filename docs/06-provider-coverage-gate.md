# Provider Coverage Gate

## Benchmark Dataset Readiness

The checked-in file `tests/golden/recent-deals-benchmark.json` is validated in
two stages:

- **Scaffold** checks JSON shape for every row so CI fails fast on schema drift.
  Placeholder files (`"placeholder": true`) must still pass this stage.
- **Gate-ready** checks row counts, discovery recency, non-placeholder source
  metadata, `https` URLs, and PII heuristics. Run `pnpm benchmark:gate` from the
  repository root; it exits with a non-zero status until Task 1.2 is complete
  and the file is explicitly non-placeholder.

Implementation: `packages/domain/src/benchmark/recent-deals-benchmark-validation.ts`.

Operational steps for curators live in `tests/golden/README.md`.

## Benchmark Schema

Each benchmark row must include:

- Identity fields: origin, destination, dates, trip length.
- Source fields: discovery metadata and source URL.
- Pricing fields: all-in paid price, currency, payment path.
- Itinerary fields: transfer and baggage assumptions.

## Matching Rules

- Same origin and destination airport group.
- Date tolerances from env defaults.
- Trip-length tolerance `+/-2 days`.
- Compatible stops, layover, and baggage assumptions.
- At least one matching provider offer in probe snapshot.

## Pass/Fail

- Reproduction rate must be `>=70%`.
- Price within `+/-20%` after AR cost normalization.
- Probe run must happen within `24h` of benchmark row.

## Manual Override

Manual override is allowed only when:

- Explicitly documented in this file.
- Failure modes are accepted and named.
- Mitigations are listed with owner and follow-up date.

## Report Template

| Provider | Probe Date | Rows Probed | Matches | Reproduction % | Price Tolerance % Pass | Result | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ |
