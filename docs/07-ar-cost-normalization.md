# AR Cost Normalization

## Versioning

- Ruleset version key: `AR_TAX_RULESET_VERSION`.
- Initial version: `v2026-04`.

## Default Path

- Payment path: `foreign_card` + `merchant_outside_ar`.
- No AR tax adjustment is applied.

## AR-Merchant Exception Class

AR tax adjustment applies when all are true:

- Merchant country is `AR`.
- Fare is constrained to ARS or documented AR-local fare class.
- Provider metadata marks local merchant settlement.

Examples:

- Flybondi ARS fares.
- JetSmart Argentina domestic fares.
- Aerolineas Argentinas ARS-only promos.
- Despegar or Almundo ARS-locked offers.

## Rules Table

| Rule | Condition | Action |
| --- | --- | --- |
| R1 | Merchant outside AR | Use quoted amount as payable basis |
| R2 | Merchant in AR and ARS-only fare | Apply AR exception tax stack |
| R3 | Merchant in AR but not ARS-only | No tax stack, flag for review |

## FX Policy

- Primary source: BNA reference rate.
- Fallback source: openexchangerates snapshot.
- Stale policy: reject rates older than `FX_RATE_TTL_HOURS`.

## Refresh Cadence

- Tax ruleset review: monthly.
- FX rate refresh: every hour.
