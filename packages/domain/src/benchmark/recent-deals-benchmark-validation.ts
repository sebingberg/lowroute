import { isIP } from "node:net";

import type { PaymentPath } from "../entities/offer.js";

const PAYMENT_PATHS: readonly PaymentPath[] = ["foreign_card", "ar_card", "merchant_outside_ar"];

const BAGGAGE_PROFILES = ["backpack_carryon"] as const;

/** Reserved/publicly fake hostnames that must not appear in gate-ready source URLs. */
const BLOCKED_URL_HOSTNAMES = [
  "example.com",
  "example.org",
  "example.net",
  "localhost",
  "127.0.0.1",
  "::1",
] as const;

/** Sentinel values reserved for scaffold / docs samples only. */
const PLACEHOLDER_SOURCE_SITES = new Set(["sample-source"]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

const PII_EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const PII_PERCENT_ENCODED_EMAIL =
  /[a-zA-Z0-9._%+-]+(?:%40|%2540)[a-zA-Z0-9.-]+(?:\.|%2e|%252e)[a-zA-Z]{2,}/i;

const BLOCKED_IPV6_CIDRS = [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001::", 32],
  ["2001:2::", 48],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["5f00::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const;

const ROOT_KEYS = ["placeholder", "rows"] as const;

const ROW_KEYS = [
  "origin",
  "destination",
  "departure_date",
  "return_date",
  "trip_length_days",
  "discovered_date",
  "source_site",
  "source_url",
  "merchant_country",
  "recorded_all_in_paid_price",
  "currency",
  "paid_via",
  "fx_snapshot",
  "carrier",
  "operating_carrier",
  "self_transfer",
  "separate_tickets",
  "airport_changes",
  "overnight_layover",
  "checked_bag_included",
  "carry_on_included",
  "manual_search_assumptions",
] as const;

const FX_SNAPSHOT_KEYS = ["source", "rate", "captured_at_utc"] as const;

const MANUAL_ASSUMPTION_KEYS = ["max_stops", "max_layover_hours", "baggage_profile"] as const;

export type RecentDealsFxSnapshot = {
  readonly source: string;
  readonly rate: number;
  readonly captured_at_utc: string;
};

export type RecentDealsManualAssumptions = {
  readonly max_stops: number;
  readonly max_layover_hours: number;
  readonly baggage_profile: (typeof BAGGAGE_PROFILES)[number];
};

export type RecentDealsBenchmarkRow = {
  readonly origin: string;
  readonly destination: string;
  readonly departure_date: string;
  readonly return_date: string;
  readonly trip_length_days: number;
  readonly discovered_date: string;
  readonly source_site: string;
  readonly source_url: string;
  readonly merchant_country: string;
  readonly recorded_all_in_paid_price: number;
  readonly currency: string;
  readonly paid_via: PaymentPath;
  readonly fx_snapshot: RecentDealsFxSnapshot;
  readonly carrier: string;
  readonly operating_carrier: string;
  readonly self_transfer: boolean;
  readonly separate_tickets: boolean;
  readonly airport_changes: boolean;
  readonly overnight_layover: boolean;
  readonly checked_bag_included: boolean;
  readonly carry_on_included: boolean;
  readonly manual_search_assumptions: RecentDealsManualAssumptions;
};

export type RecentDealsBenchmarkFile = {
  readonly placeholder: boolean;
  readonly rows: RecentDealsBenchmarkRow[];
};

export type ScaffoldValidation =
  | { readonly ok: true; readonly value: RecentDealsBenchmarkFile }
  | { readonly ok: false; readonly errors: readonly string[] };

export type GateReadyValidation =
  | { readonly ok: true; readonly value: RecentDealsBenchmarkFile }
  | { readonly ok: false; readonly errors: readonly string[] };

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isPaymentPath(x: unknown): x is PaymentPath {
  return typeof x === "string" && (PAYMENT_PATHS as readonly string[]).includes(x);
}

function isBaggageProfile(x: unknown): x is (typeof BAGGAGE_PROFILES)[number] {
  return typeof x === "string" && (BAGGAGE_PROFILES as readonly string[]).includes(x);
}

function push(errors: string[], rowPrefix: string, message: string): void {
  errors.push(`${rowPrefix}${message}`);
}

function assertOnlyKnownKeys(
  errors: string[],
  rowPrefix: string,
  raw: Record<string, unknown>,
  allowedKeys: readonly string[],
  context: string,
): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) {
      push(errors, rowPrefix, `unexpected key "${key}" on ${context}`);
      return;
    }
  }
}

function validateFxSnapshot(
  errors: string[],
  rowPrefix: string,
  raw: unknown,
  field = "fx_snapshot",
): RecentDealsFxSnapshot | undefined {
  if (!isRecord(raw)) {
    push(errors, rowPrefix, `${field} must be an object`);
    return;
  }
  assertOnlyKnownKeys(errors, rowPrefix, raw, FX_SNAPSHOT_KEYS, field);
  const source = raw.source;
  const rate = raw.rate;
  const captured_at_utc = raw.captured_at_utc;
  if (typeof source !== "string" || source.trim().length === 0) {
    push(errors, rowPrefix, `${field}.source must be a non-empty string`);
  }
  if (typeof rate !== "number" || Number.isNaN(rate) || rate <= 0) {
    push(errors, rowPrefix, `${field}.rate must be a positive number`);
  }
  if (typeof captured_at_utc !== "string" || parseIsoInstantUtc(captured_at_utc) === undefined) {
    push(errors, rowPrefix, `${field}.captured_at_utc must be an ISO-8601 UTC instant`);
  }
  if (errors.some((e) => e.startsWith(rowPrefix))) {
    return;
  }
  return {
    source: source as string,
    rate: rate as number,
    captured_at_utc: captured_at_utc as string,
  };
}

function validateManualAssumptions(
  errors: string[],
  rowPrefix: string,
  raw: unknown,
): RecentDealsManualAssumptions | undefined {
  if (!isRecord(raw)) {
    push(errors, rowPrefix, "manual_search_assumptions must be an object");
    return;
  }
  assertOnlyKnownKeys(errors, rowPrefix, raw, MANUAL_ASSUMPTION_KEYS, "manual_search_assumptions");
  const max_stops = raw.max_stops;
  const max_layover_hours = raw.max_layover_hours;
  const baggage_profile = raw.baggage_profile;
  if (typeof max_stops !== "number" || max_stops < 0 || !Number.isInteger(max_stops)) {
    push(errors, rowPrefix, "manual_search_assumptions.max_stops must be a non-negative integer");
  }
  if (
    typeof max_layover_hours !== "number" ||
    max_layover_hours <= 0 ||
    Number.isNaN(max_layover_hours)
  ) {
    push(
      errors,
      rowPrefix,
      "manual_search_assumptions.max_layover_hours must be a positive number",
    );
  }
  if (!isBaggageProfile(baggage_profile)) {
    push(
      errors,
      rowPrefix,
      `manual_search_assumptions.baggage_profile must be one of: ${BAGGAGE_PROFILES.join(", ")}`,
    );
  }
  if (errors.some((e) => e.startsWith(rowPrefix))) {
    return;
  }
  return {
    max_stops: max_stops as number,
    max_layover_hours: max_layover_hours as number,
    baggage_profile: baggage_profile as RecentDealsManualAssumptions["baggage_profile"],
  };
}

function validateRowShape(
  errors: string[],
  rowPrefix: string,
  raw: unknown,
): RecentDealsBenchmarkRow | undefined {
  if (!isRecord(raw)) {
    push(errors, rowPrefix, "row must be an object");
    return;
  }
  assertOnlyKnownKeys(errors, rowPrefix, raw, ROW_KEYS, "row");
  if (errors.some((e) => e.startsWith(rowPrefix))) {
    return;
  }

  const str = (k: string): string | undefined => {
    const v = raw[k];
    if (typeof v !== "string" || v.trim().length === 0) {
      push(errors, rowPrefix, `${k} must be a non-empty string`);
      return;
    }
    return v;
  };

  const iata = (k: string, v: string | undefined) => {
    if (v === undefined) {
      return;
    }
    if (!/^[A-Z]{3}$/.test(v)) {
      push(errors, rowPrefix, `${k} must be a 3-letter IATA airport code`);
    }
  };

  const origin = str("origin");
  iata("origin", origin);
  const destination = str("destination");
  iata("destination", destination);

  for (const k of ["departure_date", "return_date", "discovered_date"] as const) {
    const v = str(k);
    if (v !== undefined) {
      if (!ISO_DATE.test(v)) {
        push(errors, rowPrefix, `${k} must be YYYY-MM-DD`);
      } else if (parseIsoDateStartUtc(v) === undefined) {
        push(errors, rowPrefix, `${k} must be a valid YYYY-MM-DD calendar date`);
      }
    }
  }

  const trip = raw.trip_length_days;
  if (typeof trip !== "number" || !Number.isInteger(trip) || trip < 1) {
    push(errors, rowPrefix, "trip_length_days must be a positive integer");
  }

  str("source_site");
  str("source_url");

  const mc = str("merchant_country");
  if (mc !== undefined && !/^[A-Z]{2}$/.test(mc)) {
    push(errors, rowPrefix, "merchant_country must be ISO 3166-1 alpha-2 (uppercase)");
  }

  const price = raw.recorded_all_in_paid_price;
  if (
    typeof price !== "number" ||
    !Number.isFinite(price) ||
    price <= 0 ||
    !Number.isInteger(price)
  ) {
    push(
      errors,
      rowPrefix,
      "recorded_all_in_paid_price must be a positive integer (minor units or whole currency units per ops convention)",
    );
  }

  const cur = str("currency");
  if (cur !== undefined && !/^[A-Z]{3}$/.test(cur)) {
    push(errors, rowPrefix, "currency must be ISO 4217 (three uppercase letters)");
  }

  if (!isPaymentPath(raw.paid_via)) {
    push(errors, rowPrefix, `paid_via must be one of: ${PAYMENT_PATHS.join(", ")}`);
  }

  const fx = validateFxSnapshot(errors, rowPrefix, raw.fx_snapshot);
  const manual = validateManualAssumptions(errors, rowPrefix, raw.manual_search_assumptions);

  for (const k of ["carrier", "operating_carrier"] as const) {
    const v = str(k);
    if (v !== undefined && !/^[A-Z0-9]{2,3}$/.test(v)) {
      push(errors, rowPrefix, `${k} must be a 2-3 character IATA carrier code`);
    }
  }

  for (const k of [
    "self_transfer",
    "separate_tickets",
    "airport_changes",
    "overnight_layover",
    "checked_bag_included",
    "carry_on_included",
  ] as const) {
    if (typeof raw[k] !== "boolean") {
      push(errors, rowPrefix, `${k} must be a boolean`);
    }
  }

  if (errors.some((e) => e.startsWith(rowPrefix))) {
    return;
  }

  return {
    origin: raw.origin as string,
    destination: raw.destination as string,
    departure_date: raw.departure_date as string,
    return_date: raw.return_date as string,
    trip_length_days: trip as number,
    discovered_date: raw.discovered_date as string,
    source_site: raw.source_site as string,
    source_url: raw.source_url as string,
    merchant_country: raw.merchant_country as string,
    recorded_all_in_paid_price: price as number,
    currency: raw.currency as string,
    paid_via: raw.paid_via as PaymentPath,
    fx_snapshot: fx as RecentDealsFxSnapshot,
    carrier: raw.carrier as string,
    operating_carrier: raw.operating_carrier as string,
    self_transfer: raw.self_transfer as boolean,
    separate_tickets: raw.separate_tickets as boolean,
    airport_changes: raw.airport_changes as boolean,
    overnight_layover: raw.overnight_layover as boolean,
    checked_bag_included: raw.checked_bag_included as boolean,
    carry_on_included: raw.carry_on_included as boolean,
    manual_search_assumptions: manual as RecentDealsManualAssumptions,
  };
}

/**
 * Structural validation for `tests/golden/recent-deals-benchmark.json`.
 * Placeholder datasets must still satisfy row shape so CI catches typos early.
 */
export function validateBenchmarkScaffold(raw: unknown): ScaffoldValidation {
  const errors: string[] = [];
  if (!isRecord(raw)) {
    return { ok: false, errors: ["root must be a JSON object"] };
  }
  assertOnlyKnownKeys(errors, "", raw, ROOT_KEYS, "root");
  if (typeof raw.placeholder !== "boolean") {
    errors.push('root.placeholder must be a boolean (omit "true" string form)');
  }
  if (!Array.isArray(raw.rows)) {
    errors.push("root.rows must be an array");
    return { ok: false, errors };
  }
  const rows: RecentDealsBenchmarkRow[] = [];
  raw.rows.forEach((item, i) => {
    const prefix = `rows[${i}]: `;
    const row = validateRowShape(errors, prefix, item);
    if (row) {
      rows.push(row);
    }
  });
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: { placeholder: raw.placeholder as boolean, rows },
  };
}

function parseHttpsUrl(url: string): URL | undefined {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") {
      return;
    }
    return u;
  } catch {
    return;
  }
}

function parseIsoDateStartUtc(date: string): number | undefined {
  if (!ISO_DATE.test(date)) {
    return;
  }
  const [year, month, day] = date.split("-").map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return;
  }
  return timestamp;
}

function parseIsoInstantUtc(instant: string): number | undefined {
  if (!ISO_INSTANT.test(instant)) {
    return;
  }
  const timestamp = Date.parse(instant);
  if (!Number.isFinite(timestamp)) {
    return;
  }
  const [datePart, timePartWithZone] = instant.slice(0, -1).split("T");
  const timePart = timePartWithZone ?? "";
  const [year, month, day] = datePart.split("-").map(Number);
  const [clockPart] = timePart.split(".");
  const [hour, minute, second] = clockPart.split(":").map(Number);
  const parsed = new Date(timestamp);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day ||
    parsed.getUTCHours() !== hour ||
    parsed.getUTCMinutes() !== minute ||
    parsed.getUTCSeconds() !== second
  ) {
    return;
  }
  return timestamp;
}

function findBlockedUrlHostname(hostname: string): string | undefined {
  const lower = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "");
  const ipv4Address = isIP(lower) === 4 ? parseIpv4Address(lower) : undefined;
  if (ipv4Address && isBlockedIpv4Address(ipv4Address)) {
    return ipv4Address.join(".");
  }
  if (lower.startsWith("::ffff:")) {
    return "::ffff";
  }
  if (isBlockedIpv6Address(lower)) {
    return lower;
  }
  for (const blocked of BLOCKED_URL_HOSTNAMES) {
    if (lower === blocked || lower.endsWith(`.${blocked}`)) {
      return blocked;
    }
  }
  return;
}

function parseIpv4Address(hostname: string): [number, number, number, number] | undefined {
  const parts = hostname.split(".");
  if (parts.length !== 4) {
    return;
  }
  const octets = parts.map((part) => {
    if (!/^\d+$/.test(part)) {
      return Number.NaN;
    }
    const value = Number(part);
    return Number.isInteger(value) && value >= 0 && value <= 255 ? value : Number.NaN;
  });
  if (octets.some((octet) => Number.isNaN(octet))) {
    return;
  }
  return octets as [number, number, number, number];
}

function isBlockedIpv4Address([a, b, c]: [number, number, number, number]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    (a === 100 && b >= 64 && b <= 127) ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 31 && c === 196) ||
    (a === 192 && b === 52 && c === 193) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 175 && c === 48) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    (a >= 224 && a <= 255)
  );
}

function isBlockedIpv6Address(hostname: string): boolean {
  if (isIP(hostname) !== 6) {
    return false;
  }
  const words = parseIpv6Address(hostname);
  if (!words) {
    return false;
  }
  const embeddedIpv4 = ipv6CompatibleIpv4Address(words);
  if (embeddedIpv4 && isBlockedIpv4Address(embeddedIpv4)) {
    return true;
  }
  return BLOCKED_IPV6_CIDRS.some(([network, prefixLength]) =>
    ipv6MatchesPrefix(words, parseIpv6Address(network) ?? [], prefixLength),
  );
}

function parseIpv6Address(hostname: string): number[] | undefined {
  const compressedParts = hostname.split("::");
  if (compressedParts.length > 2) {
    return;
  }
  const parsePart = (part: string): number[] | undefined => {
    if (part.length === 0) {
      return [];
    }
    const words = part.split(":").map((word) => {
      if (!/^[0-9a-f]{1,4}$/i.test(word)) {
        return Number.NaN;
      }
      return Number.parseInt(word, 16);
    });
    return words.some((word) => Number.isNaN(word)) ? undefined : words;
  };
  if (compressedParts.length === 1) {
    const words = parsePart(hostname);
    return words?.length === 8 ? words : undefined;
  }
  const [headPart = "", tailPart = ""] = compressedParts;
  const head = parsePart(headPart);
  const tail = parsePart(tailPart);
  if (!head || !tail) {
    return;
  }
  const missingWords = 8 - head.length - tail.length;
  if (missingWords < 1) {
    return;
  }
  return [...head, ...Array.from({ length: missingWords }, () => 0), ...tail];
}

function ipv6CompatibleIpv4Address(
  words: readonly number[],
): [number, number, number, number] | undefined {
  if (words.length !== 8 || !words.slice(0, 6).every((word) => word === 0)) {
    return;
  }
  return [words[6] >> 8, words[6] & 0xff, words[7] >> 8, words[7] & 0xff];
}

function ipv6MatchesPrefix(
  words: readonly number[],
  networkWords: readonly number[],
  prefixLength: number,
): boolean {
  if (words.length !== 8 || networkWords.length !== 8) {
    return false;
  }
  const fullWords = Math.floor(prefixLength / 16);
  const remainingBits = prefixLength % 16;
  for (let i = 0; i < fullWords; i += 1) {
    if (words[i] !== networkWords[i]) {
      return false;
    }
  }
  if (remainingBits === 0) {
    return true;
  }
  const mask = (0xffff << (16 - remainingBits)) & 0xffff;
  return (words[fullWords] & mask) === (networkWords[fullWords] & mask);
}

function collectJsonStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const x of value) {
      collectJsonStrings(x, out);
    }
  } else if (isRecord(value)) {
    for (const v of Object.values(value)) {
      collectJsonStrings(v, out);
    }
  }
}

function decodeValidPercentTriplets(value: string): string {
  let normalized = value;
  for (let i = 0; i < value.length; i += 1) {
    const next = normalized.replaceAll(/%([0-9a-f]{2})/gi, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
    if (next === normalized) {
      return normalized;
    }
    normalized = next;
  }
  return normalized;
}

function assertPiiFree(errors: string[], rowPrefix: string, row: RecentDealsBenchmarkRow): void {
  const blobs: string[] = [];
  collectJsonStrings(row, blobs);
  for (const s of blobs) {
    let decoded = s;
    try {
      decoded = decodeURIComponent(s);
    } catch {
      decoded = s;
    }
    const normalizedPercentTriplets = decodeValidPercentTriplets(s);
    if (
      PII_EMAIL.test(s) ||
      PII_EMAIL.test(decoded) ||
      PII_EMAIL.test(normalizedPercentTriplets) ||
      PII_PERCENT_ENCODED_EMAIL.test(s) ||
      PII_PERCENT_ENCODED_EMAIL.test(decoded) ||
      PII_PERCENT_ENCODED_EMAIL.test(normalizedPercentTriplets)
    ) {
      push(errors, rowPrefix, "string fields must not contain email-shaped tokens");
      return;
    }
  }
}

const GATE_MIN_ROWS = 20;
const GATE_MAX_ROWS = 30;
const DISCOVERY_LOOKBACK_MS = 90 * 86_400_000;

/**
 * Gate-ready validation for provider coverage inputs.
 * Returns `ok: false` when `placeholder` is true (explicit Task 1.2 blocker message).
 */
export function validateBenchmarkGateReady(
  raw: unknown,
  options?: { readonly now?: Date },
): GateReadyValidation {
  const scaffold = validateBenchmarkScaffold(raw);
  if (!scaffold.ok) {
    return scaffold;
  }
  const { value } = scaffold;
  const errors: string[] = [];
  const now = options?.now ?? new Date();

  if (value.placeholder === true) {
    errors.push(
      'Benchmark is not gate-ready: "placeholder" is true. Replace rows with 20-30 sanitized real deals (Task 1.2) and set "placeholder": false.',
    );
    return { ok: false, errors };
  }

  if (value.rows.length < GATE_MIN_ROWS || value.rows.length > GATE_MAX_ROWS) {
    errors.push(
      `Benchmark is not gate-ready: expected between ${GATE_MIN_ROWS} and ${GATE_MAX_ROWS} rows, got ${value.rows.length}.`,
    );
  }

  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const oldestAllowed = todayUtc - DISCOVERY_LOOKBACK_MS;

  value.rows.forEach((row, i) => {
    const prefix = `rows[${i}]: `;
    assertPiiFree(errors, prefix, row);
    const discovered = parseIsoDateStartUtc(row.discovered_date);
    if (discovered === undefined) {
      push(errors, prefix, "discovered_date must be a valid YYYY-MM-DD calendar date");
    } else if (discovered < oldestAllowed) {
      push(
        errors,
        prefix,
        `discovered_date must fall within the last 90 days relative to validation time (cutoff ${new Date(oldestAllowed).toISOString().slice(0, 10)})`,
      );
    } else if (discovered > todayUtc) {
      push(errors, prefix, "discovered_date must not be in the future");
    }
    if (PLACEHOLDER_SOURCE_SITES.has(row.source_site)) {
      push(errors, prefix, 'source_site must not use scaffold sentinel "sample-source"');
    }
    const url = parseHttpsUrl(row.source_url);
    if (!url) {
      push(errors, prefix, "source_url must be a valid https URL");
    } else {
      const blockedHost = findBlockedUrlHostname(url.hostname);
      if (blockedHost !== undefined) {
        push(errors, prefix, `source_url must not use reserved hostname "${blockedHost}"`);
      }
    }
  });

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value };
}
