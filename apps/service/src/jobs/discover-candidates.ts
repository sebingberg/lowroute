import {
  DISCOVERY_DATE_HORIZON_DAYS,
  DISCOVERY_DATE_STEP_DAYS,
  DISCOVERY_WINDOWS,
  type Env,
  readEnv,
} from "@lowroute/config";
import { destinations } from "@lowroute/domain";

export type Candidate = {
  readonly origin: string;
  readonly destination: string;
  readonly departure_date: string;
  readonly min_trip_days: number;
  readonly max_trip_days: number;
};

export type DiscoverCandidatesOptions = {
  readonly now?: Date;
  readonly env?: Partial<
    Pick<
      Env,
      | "ALLOWED_ORIGINS"
      | "ENABLE_EPA"
      | "DUFFEL_REQ_LIMIT_PER_RUN"
      | "KIWI_REQ_LIMIT_PER_RUN"
      | "TRAVELPAYOUTS_REQ_LIMIT_PER_RUN"
      | "PROVIDER_LIMIT_OVERFLOW_BEHAVIOR"
    >
  >;
};

const resolveEnv = (env: DiscoverCandidatesOptions["env"]): Env => {
  return readEnv({ ...process.env, ...(env ?? {}) });
};

const addDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const toDateOnly = (date: Date): string => {
  return date.toISOString().slice(0, 10);
};

const allowedOrigins = (env: Pick<Env, "ALLOWED_ORIGINS" | "ENABLE_EPA">): string[] => {
  const origins = env.ENABLE_EPA
    ? env.ALLOWED_ORIGINS
    : env.ALLOWED_ORIGINS.filter((origin) => origin !== "EPA");
  return [...new Set(origins)];
};

/** One discovery candidate maps to one search request per provider at fetch time. */
const discoveryBudgetPerRun = (env: Env): number => {
  return Math.min(
    env.DUFFEL_REQ_LIMIT_PER_RUN,
    env.KIWI_REQ_LIMIT_PER_RUN,
    env.TRAVELPAYOUTS_REQ_LIMIT_PER_RUN,
  );
};

const applyDiscoveryBudget = (
  ordered: Candidate[],
  budget: number,
  behavior: Env["PROVIDER_LIMIT_OVERFLOW_BEHAVIOR"],
): Candidate[] => {
  if (ordered.length <= budget) {
    return ordered;
  }

  if (behavior === "skip") {
    return ordered.slice(0, budget);
  }

  return ordered.slice(ordered.length - budget);
};

export const discoverCandidates = (options: DiscoverCandidatesOptions = {}): Candidate[] => {
  const env = resolveEnv(options.env);
  const now = options.now ?? new Date();
  const horizonDays: number[] = [];
  for (
    let daysFromNow = DISCOVERY_DATE_HORIZON_DAYS.min;
    daysFromNow <= DISCOVERY_DATE_HORIZON_DAYS.max;
    daysFromNow += DISCOVERY_DATE_STEP_DAYS
  ) {
    horizonDays.push(daysFromNow);
  }

  const origins = allowedOrigins(env);
  // ! Keep ordering stable as horizon -> destination -> origin so budget slicing stays deterministic.
  const ordered: Candidate[] = horizonDays.flatMap((daysFromNow) => {
    return destinations.flatMap((destination) => {
      const window = DISCOVERY_WINDOWS[destination.tier];

      return origins.map((origin) => ({
        departure_date: toDateOnly(addDays(now, daysFromNow)),
        destination: destination.code,
        max_trip_days: window.max_trip_days,
        min_trip_days: window.min_trip_days,
        origin,
      }));
    });
  });

  return applyDiscoveryBudget(
    ordered,
    discoveryBudgetPerRun(env),
    env.PROVIDER_LIMIT_OVERFLOW_BEHAVIOR,
  );
};
