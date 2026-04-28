# Provider Matrix

Canonical gate columns live in `packages/domain/data/provider-gates.yaml`. Keep
this table aligned when that file changes. `GET /provider-status` reads the YAML
(no live provider credentials required).

Task 0.4 (live credentials, commercial terms, rate limits, billing validation)
remains **external** to the repo; `task_0_4_external_validation` in the YAML
tracks completion of that work separately from the documentation columns below.

## Access and Commercial Gate

| Provider | Credentials Tested | Terms Allow Use Case | Rate Limits Known | Cost/Billing Documented | Phase 1 Status |
| --- | --- | --- | --- | --- | --- |
| Duffel | Pending | Pending | Pending | Pending | Pending |
| Kiwi Tequila | Pending | Pending | Pending | Pending | Pending |
| Travelpayouts | Pending | Pending | Pending | Pending | Pending |

## Notes

- Update `provider-gates.yaml` and this table during Task 0.4.
- Any rejected provider must include fallback notes and rationale.
