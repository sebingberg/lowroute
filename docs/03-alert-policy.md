# Alert Policy

## Delivery Controls

- `TELEGRAM_ALERTS_ENABLED` defaults to `false`.
- `ALERT_DRY_RUN` suppresses Telegram sends and logs payloads.

## Fingerprint Composition

## `offer_fingerprint`

- `provider` + `origin` + `destination` + `departure_date` + `return_date`.
- Include normalized total amount and itinerary shape fields.

## `alert_fingerprint`

- `offer_fingerprint` + destination chat + alert template version.

## `probe_run_id`

- Stable UUID generated once per paired coverage probe run.

## Itinerary Risk Flags

Possible flags in message payload:

- `[self-transfer]`
- `[separate tickets]`
- `[airport change <from>-><to>]`
- `[overnight layover]`
- `[no checked bag]`

## Penalty Weights

- Airport change: `-8`.
- Overnight layover: `-10`.
- Self-transfer: `-15`.
- Separate tickets: `-12`.
- Sub-90-minute self-connection: `-18`.

## Currency Display

- Primary: normalized payable amount in USD.
- Secondary: provider quoted amount and currency.
- ARS is shown only for AR-merchant exception-class fares.
