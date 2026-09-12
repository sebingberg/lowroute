import { z } from "zod";

import { PROVIDER_REQ_LIMIT_PER_RUN_DEFAULT } from "./constants.js";

const booleanEnv = (defaultValue: boolean) => {
  return z
    .preprocess(
      (value) => {
        if (value === undefined) {
          return String(defaultValue);
        }

        return value;
      },
      z.union([z.boolean(), z.enum(["true", "false"])]),
    )
    .transform((value) => value === true || value === "true");
};

const optionalNumberEnv = () => {
  return z.preprocess((value) => {
    if (value === "") {
      return undefined;
    }

    return value;
  }, z.coerce.number().min(0).max(1).optional());
};

const originsEnv = z.preprocess(
  (value) => {
    if (value === undefined || value === "") {
      return ["EZE", "AEP"];
    }

    if (Array.isArray(value)) {
      return value;
    }

    return String(value)
      .split(",")
      .map((origin) => origin.trim().toUpperCase())
      .filter(Boolean);
  },
  z.array(z.string().length(3)).min(1),
);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  DATABASE_URL: z.string().min(1).default("postgres://postgres:postgres@localhost:5432/lowroute"),
  APP_TIMEZONE: z.string().default("America/Argentina/Buenos_Aires"),
  TELEGRAM_BOT_TOKEN: z.string().default(""),
  TELEGRAM_CHAT_ID: z.string().default(""),
  TELEGRAM_ALERTS_ENABLED: booleanEnv(false),
  ALERT_DRY_RUN: booleanEnv(true),
  ALERT_COOLDOWN_HOURS: z.coerce.number().int().positive().default(24),
  DEFAULT_PAYMENT_PATH: z
    .enum(["foreign_card", "ar_card", "merchant_outside_ar"])
    .default("foreign_card"),
  AR_TAX_RULESET_VERSION: z.string().default("v2026-04"),
  FX_RATE_SOURCE: z.string().default("bna"),
  FX_RATE_TTL_HOURS: z.coerce.number().int().positive().default(6),
  DEAL_PERCENTILE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.2),
  DEAL_DISCOUNT_PCT: optionalNumberEnv(),
  MAX_LAYOVER_HOURS: z.coerce.number().positive().default(8),
  ALLOWED_ORIGINS: originsEnv,
  ENABLE_EPA: booleanEnv(false),
  COVERAGE_THRESHOLD_PCT: z.coerce.number().int().min(0).max(100).default(70),
  COVERAGE_PRICE_TOLERANCE_PCT: z.coerce.number().int().min(0).max(100).default(20),
  COVERAGE_TRIP_DAYS_TOLERANCE: z.coerce.number().int().positive().default(2),
  COVERAGE_DEPARTURE_DATE_TOLERANCE_DAYS: z.coerce.number().int().positive().default(7),
  COVERAGE_RETURN_DATE_TOLERANCE_DAYS: z.coerce.number().int().positive().default(7),
  DUFFEL_REQ_LIMIT_PER_RUN: z.coerce
    .number()
    .int()
    .positive()
    .default(PROVIDER_REQ_LIMIT_PER_RUN_DEFAULT.duffel),
  KIWI_REQ_LIMIT_PER_RUN: z.coerce
    .number()
    .int()
    .positive()
    .default(PROVIDER_REQ_LIMIT_PER_RUN_DEFAULT.kiwi),
  TRAVELPAYOUTS_REQ_LIMIT_PER_RUN: z.coerce
    .number()
    .int()
    .positive()
    .default(PROVIDER_REQ_LIMIT_PER_RUN_DEFAULT.travelpayouts),
  PROVIDER_LIMIT_OVERFLOW_BEHAVIOR: z.enum(["skip", "defer"]).default("skip"),
  DUFFEL_API_KEY: z.string().default(""),
  KIWI_API_KEY: z.string().default(""),
  TRAVELPAYOUTS_TOKEN: z.string().default(""),
});

export type Env = z.infer<typeof envSchema>;

export const readEnv = (input: Record<string, unknown>): Env => {
  return envSchema.parse(input);
};
