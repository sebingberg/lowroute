# Golden Dataset

`recent-deals-benchmark.json` stores sanitized benchmark rows used for the
provider coverage gate.

The current file is marked `"placeholder": true`; gate runners must reject it
until Task 1.2 replaces the sample rows with real benchmark data.

## Validation Layers

1. **Scaffold (structural)**  
   Row shape, required keys, enums (`paid_via`, `baggage_profile`), and
   basic types are enforced so typos fail CI early. A placeholder file must
   still pass this layer.  
   Checked by Vitest: `packages/domain/src/benchmark/recent-deals-benchmark-validation.test.ts`
   (loads this JSON from the repo root).

2. **Gate-ready**  
   Additional rules for production coverage inputs: `placeholder` must be
   `false`, 20-30 rows, `discovered_date` within the last 90 days (relative to
   validation time), no scaffold sentinels (`sample-source`, `example.com` URLs),
   `https` source URLs, and lightweight PII heuristics (for example no
   email-shaped tokens in row strings; no suspicious extra keys such as
   `passenger_email`).  
   Run from the repo root:

   ```bash
   pnpm benchmark:gate
   ```

   Expect exit code `1` while the file remains a placeholder; exit code `0`
   only when Task 1.2 is satisfied.

## Populating Real Data (Task 1.2)

Do not fabricate fares or itineraries. Collect 20-30 **real** deals discovered
within the last 90 days, then:

1. Strip PII and personal booking identifiers. Keep only public deal-page URLs
   and aggregator or airline sources you are allowed to retain.
2. Fill every field in the [benchmark row schema](../../docs/project-scaffold.plan.md#benchmark-row-schema)
   (same shape as the sample rows in this file).
3. Set `"placeholder": false` only after the dataset is complete.
4. Run `pnpm benchmark:gate` and fix reported errors before declaring the
   dataset gate-ready.

## Dataset Requirements

- 20-30 deals discovered in the last 90 days.
- Includes all schema fields from plan Task 1.2.
- Excludes PII and booking references.
- Preserves capture-time FX context.
- `recorded_all_in_paid_price` is validated as a **positive integer** (whole
  units in the recorded currency; adjust if you standardize on minor units).
