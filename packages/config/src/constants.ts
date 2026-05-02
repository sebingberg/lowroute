export const DEFAULT_ALLOWED_ORIGINS = ["EZE", "AEP"] as const;

export const DISTANCE_BANDS = {
  near: { min_km: 0, max_km: 2500 },
  medium: { min_km: 2501, max_km: 7000 },
  far: { min_km: 7001, max_km: Number.POSITIVE_INFINITY },
} as const;

export const DISCOVERY_WINDOWS = {
  near: { min_trip_days: 7, max_trip_days: 14 },
  medium: { min_trip_days: 14, max_trip_days: 21 },
  far: { min_trip_days: 21, max_trip_days: 35 },
} as const;

export const DISCOVERY_DATE_HORIZON_DAYS = {
  min: 30,
  max: 330,
} as const;

export const DISCOVERY_DATE_STEP_DAYS = 7;

/** Default per-provider max search requests issued in one discovery run (env overrides). */
export const PROVIDER_REQ_LIMIT_PER_RUN_DEFAULT = {
  duffel: 120,
  kiwi: 120,
  travelpayouts: 120,
} as const;

export const MIN_TRIP_DAYS_BY_TIER = {
  near: 7,
  medium: 14,
  far: 21,
} as const;

export const MAX_LAYOVER_HOURS_DEFAULT = 8;

export const ITINERARY_PENALTIES = {
  airport_change: 8,
  overnight_layover: 10,
  self_transfer: 15,
  separate_tickets: 12,
  short_self_connection: 18,
} as const;
