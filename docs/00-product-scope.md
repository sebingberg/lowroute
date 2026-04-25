# Product Scope

Lowroute is an MVP bot that finds economy fare deals from Buenos Aires and
sends private Telegram alerts only when strict travel constraints pass.

## In Scope

- Origins: `EZE` and `AEP`, with optional `EPA` behind flag.
- Economy-cabin discovery and filtering.
- Candidate search, scoring, and alerting pipeline.
- Private Telegram notifications with itinerary risk flags.
- Postgres-backed persistence and idempotent alert suppression.

## Out of Scope

- Booking execution and payment processing.
- Public web UI.
- In-house scraping pipelines.
- Multi-user management.
- Advanced forecasting and tracing stack.
