import { describe, expect, it } from "vitest";

import {
  buildProviderStatusPayload,
  type GateDimension,
  type GateValue,
  gatesRequireAction,
  getProviderStatusPayload,
  type ProviderGatesFile,
  providerGatesActionable,
  rollupProviderGateStatus,
} from "./provider-gates.js";

const baseGate = (
  over: Partial<Record<GateDimension, GateValue>> = {},
): Record<GateDimension, GateValue> => ({
  credentials_tested: "pending",
  terms_allow_use_case: "pending",
  rate_limits_known: "pending",
  cost_billing_documented: "pending",
  ...over,
});

describe("rollupProviderGateStatus", () => {
  it("returns rejected-gate when any gate is rejected", () => {
    expect(
      rollupProviderGateStatus(
        baseGate({
          credentials_tested: "rejected",
          terms_allow_use_case: "approved",
          rate_limits_known: "approved",
          cost_billing_documented: "approved",
        }),
      ),
    ).toBe("rejected-gate");
  });

  it("returns pending-gate when no rejections but a gate is still pending", () => {
    expect(rollupProviderGateStatus(baseGate({ credentials_tested: "approved" }))).toBe(
      "pending-gate",
    );
  });

  it("returns cleared when all gates are approved or not_applicable", () => {
    expect(
      rollupProviderGateStatus({
        credentials_tested: "approved",
        terms_allow_use_case: "not_applicable",
        rate_limits_known: "approved",
        cost_billing_documented: "approved",
      }),
    ).toBe("cleared");
  });
});

describe("gatesRequireAction", () => {
  it("is true for pending or rejected", () => {
    expect(gatesRequireAction(baseGate())).toBe(true);
    expect(gatesRequireAction(baseGate({ credentials_tested: "rejected" }))).toBe(true);
  });

  it("is false when only approved and not_applicable", () => {
    expect(
      gatesRequireAction({
        credentials_tested: "approved",
        terms_allow_use_case: "approved",
        rate_limits_known: "not_applicable",
        cost_billing_documented: "approved",
      }),
    ).toBe(false);
  });
});

describe("getProviderStatusPayload", () => {
  it("reads packages/domain/data/provider-gates.yaml", () => {
    const payload = getProviderStatusPayload();
    expect(payload.source).toBe("checked-in-gate-data");
    expect(payload.providers.map((p) => p.id).sort()).toEqual(
      ["duffel", "kiwi", "travelpayouts"].sort(),
    );
  });
});

describe("buildProviderStatusPayload", () => {
  const fileAllPending: ProviderGatesFile = {
    version: 1,
    as_of: "2026-04-28",
    task_0_4_external_validation: { complete: false },
    providers: [
      {
        id: "duffel",
        display_name: "Duffel",
        gates: baseGate(),
      },
    ],
  };

  it("sets actionable when any provider has pending or rejected gates", () => {
    const payload = buildProviderStatusPayload(fileAllPending);
    expect(payload.actionable).toBe(true);
    expect(payload.source).toBe("checked-in-gate-data");
    expect(payload.external_access_commercial_gate.complete).toBe(false);
    expect(payload.providers[0]?.name).toBe("duffel");
    expect(payload.providers[0]?.display_name).toBe("Duffel");
  });

  it("sets actionable false when all providers are cleared but keeps Task 0.4 incomplete unless flagged", () => {
    const cleared: ProviderGatesFile = {
      version: 1,
      as_of: "2026-04-28",
      task_0_4_external_validation: { complete: false },
      providers: [
        {
          id: "duffel",
          display_name: "Duffel",
          gates: {
            credentials_tested: "approved",
            terms_allow_use_case: "approved",
            rate_limits_known: "approved",
            cost_billing_documented: "approved",
          },
        },
      ],
    };
    const payload = buildProviderStatusPayload(cleared);
    expect(payload.actionable).toBe(false);
    expect(providerGatesActionable(cleared)).toBe(false);
    expect(payload.external_access_commercial_gate.complete).toBe(false);
  });

  it("reflects Task 0.4 completion only from the explicit YAML flag", () => {
    const clearedWithTask04: ProviderGatesFile = {
      version: 1,
      as_of: "2026-04-28",
      task_0_4_external_validation: { complete: true },
      providers: [
        {
          id: "duffel",
          display_name: "Duffel",
          gates: {
            credentials_tested: "approved",
            terms_allow_use_case: "approved",
            rate_limits_known: "approved",
            cost_billing_documented: "approved",
          },
        },
      ],
    };
    expect(
      buildProviderStatusPayload(clearedWithTask04).external_access_commercial_gate.complete,
    ).toBe(true);
  });

  it("rejects duplicate provider ids", () => {
    const duplicateIds: ProviderGatesFile = {
      version: 1,
      as_of: "2026-04-28",
      task_0_4_external_validation: { complete: false },
      providers: [
        {
          id: "duffel",
          display_name: "Duffel",
          gates: baseGate(),
        },
        {
          id: "Duffel",
          display_name: "Duffel Duplicate",
          gates: baseGate(),
        },
      ],
    };

    expect(() => buildProviderStatusPayload(duplicateIds)).toThrow(
      'Invalid provider-gates.yaml: duplicate provider id "Duffel"',
    );
  });
});
