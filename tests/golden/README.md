# Golden Dataset

`recent-deals-benchmark.json` stores sanitized benchmark rows used for the
provider coverage gate.

The current file is marked `"placeholder": true`; gate runners must reject it
until Task 1.2 replaces the sample rows with real benchmark data.

## Dataset Requirements

- 20-30 deals discovered in the last 90 days.
- Includes all schema fields from plan Task 1.2.
- Excludes PII and booking references.
- Preserves capture-time FX context.
