import { readFileSync } from "node:fs";
import { parse } from "yaml";

export const GATE_DIMENSIONS = [
  "credentials_tested",
  "terms_allow_use_case",
  "rate_limits_known",
  "cost_billing_documented",
] as const;

export type GateDimension = (typeof GATE_DIMENSIONS)[number];

export type GateValue = "pending" | "approved" | "rejected" | "not_applicable";

export type ProviderGateRecord = {
  readonly id: string;
  readonly display_name: string;
  readonly gates: Record<GateDimension, GateValue>;
};

export type ProviderGatesFile = {
  readonly version: number;
  readonly as_of: string;
  readonly task_0_4_external_validation: { readonly complete: boolean };
  readonly providers: ProviderGateRecord[];
};

const providerGatesUrl = new URL("../data/provider-gates.yaml", import.meta.url);

const isGateValue = (value: unknown): value is GateValue =>
  value === "pending" || value === "approved" || value === "rejected" || value === "not_applicable";

const isGateRecord = (value: unknown): value is ProviderGateRecord => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== "string" || typeof candidate.display_name !== "string") {
    return false;
  }
  if (!candidate.gates || typeof candidate.gates !== "object") {
    return false;
  }
  const gates = candidate.gates as Record<string, unknown>;
  return GATE_DIMENSIONS.every((key) => key in gates && isGateValue(gates[key]));
};

const isTask04Block = (value: unknown): value is { complete: boolean } => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.complete === "boolean";
};

const isProviderGatesFile = (value: unknown): value is ProviderGatesFile => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.version === "number" &&
    typeof candidate.as_of === "string" &&
    isTask04Block(candidate.task_0_4_external_validation) &&
    Array.isArray(candidate.providers) &&
    candidate.providers.every(isGateRecord)
  );
};

const assertUniqueProviderIds = (providers: readonly ProviderGateRecord[]): void => {
  const seen = new Set<string>();
  for (const provider of providers) {
    const key = provider.id.toLowerCase();
    if (seen.has(key)) {
      throw new Error(`Invalid provider-gates.yaml: duplicate provider id "${provider.id}"`);
    }
    seen.add(key);
  }
};

const loadProviderGatesFile = (): ProviderGatesFile => {
  const parsed = parse(readFileSync(providerGatesUrl, "utf-8"));
  if (!isProviderGatesFile(parsed)) {
    throw new Error("Invalid provider-gates.yaml");
  }
  assertUniqueProviderIds(parsed.providers);
  return parsed;
};

/** Single-provider aggregate for API consumers (legacy `status` field). */
export const rollupProviderGateStatus = (
  gates: Record<GateDimension, GateValue>,
): "pending-gate" | "rejected-gate" | "cleared" => {
  const values = GATE_DIMENSIONS.map((key) => gates[key]);
  if (values.some((v) => v === "rejected")) {
    return "rejected-gate";
  }
  if (values.some((v) => v === "pending")) {
    return "pending-gate";
  }
  return "cleared";
};

/** True when any gate still needs human follow-up (pending or rejected). */
export const gatesRequireAction = (gates: Record<GateDimension, GateValue>): boolean =>
  GATE_DIMENSIONS.some((key) => gates[key] === "pending" || gates[key] === "rejected");

export const providerGatesActionable = (file: ProviderGatesFile): boolean =>
  file.providers.some((p) => gatesRequireAction(p.gates));

export type ProviderStatusPayload = {
  readonly source: "checked-in-gate-data";
  readonly data_version: number;
  readonly as_of: string;
  readonly actionable: boolean;
  readonly external_access_commercial_gate: {
    readonly complete: boolean;
    readonly task: "0.4";
    readonly note: string;
  };
  readonly providers: readonly {
    readonly id: string;
    readonly name: string;
    readonly display_name: string;
    readonly status: ReturnType<typeof rollupProviderGateStatus>;
    readonly gates: Record<GateDimension, GateValue>;
    readonly phase1_status: "pending" | "approved" | "blocked";
  }[];
  readonly note: string;
};

const phase1FromRollup = (
  rollup: ReturnType<typeof rollupProviderGateStatus>,
): "pending" | "approved" | "blocked" => {
  if (rollup === "rejected-gate") {
    return "blocked";
  }
  if (rollup === "pending-gate") {
    return "pending";
  }
  return "approved";
};

export const buildProviderStatusPayload = (file: ProviderGatesFile): ProviderStatusPayload => {
  assertUniqueProviderIds(file.providers);
  const actionable = providerGatesActionable(file);

  return {
    source: "checked-in-gate-data",
    data_version: file.version,
    as_of: file.as_of,
    actionable,
    external_access_commercial_gate: {
      complete: file.task_0_4_external_validation.complete,
      task: "0.4",
      note: "Live credential exercises and commercial validation are out of band (Task 0.4). This payload reflects checked-in gate columns only; set task_0_4_external_validation.complete in provider-gates.yaml only after that work is done.",
    },
    providers: file.providers.map((p) => {
      const rollup = rollupProviderGateStatus(p.gates);
      return {
        id: p.id,
        name: p.id,
        display_name: p.display_name,
        status: rollup,
        gates: p.gates,
        phase1_status: phase1FromRollup(rollup),
      };
    }),
    note: "Gate columns are maintained in packages/domain/data/provider-gates.yaml (see docs/01-provider-matrix.md).",
  };
};

export const getProviderStatusPayload = (): ProviderStatusPayload =>
  buildProviderStatusPayload(loadProviderGatesFile());
