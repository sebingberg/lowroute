# Provider Coverage Gate

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
