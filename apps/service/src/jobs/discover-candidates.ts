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
  readonly env?: Pick<Env, "ALLOWED_ORIGINS" | "ENABLE_EPA">;
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

export const discoverCandidates = (options: DiscoverCandidatesOptions = {}): Candidate[] => {
  const env = options.env ?? readEnv(process.env);
  const now = options.now ?? new Date();
  const horizonDays: number[] = [];
  for (
    let daysFromNow = DISCOVERY_DATE_HORIZON_DAYS.min;
    daysFromNow <= DISCOVERY_DATE_HORIZON_DAYS.max;
    daysFromNow += DISCOVERY_DATE_STEP_DAYS
  ) {
    horizonDays.push(daysFromNow);
  }

  return allowedOrigins(env).flatMap((origin) => {
    return destinations.flatMap((destination) => {
      const window = DISCOVERY_WINDOWS[destination.tier];

      return horizonDays.map((daysFromNow) => ({
        departure_date: toDateOnly(addDays(now, daysFromNow)),
        destination: destination.code,
        max_trip_days: window.max_trip_days,
        min_trip_days: window.min_trip_days,
        origin,
      }));
    });
  });
};
