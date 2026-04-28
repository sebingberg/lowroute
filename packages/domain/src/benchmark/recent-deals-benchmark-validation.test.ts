import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  type RecentDealsBenchmarkFile,
  type RecentDealsBenchmarkRow,
  validateBenchmarkGateReady,
  validateBenchmarkScaffold,
} from "./recent-deals-benchmark-validation.js";

const checkedInFixtureUrl = new URL(
  "../../../../tests/golden/recent-deals-benchmark.json",
  import.meta.url,
);

const baseRow: RecentDealsBenchmarkRow = {
  origin: "EZE",
  destination: "MAD",
  departure_date: "2026-09-01",
  return_date: "2026-09-16",
  trip_length_days: 15,
  discovered_date: "2026-04-10",
  source_site: "travel-deals",
  source_url: "https://deals.lowroute.dev/deals/0",
  merchant_country: "US",
  recorded_all_in_paid_price: 710,
  currency: "USD",
  paid_via: "foreign_card",
  fx_snapshot: {
    source: "bna",
    rate: 1,
    captured_at_utc: "2026-04-10T15:00:00.000Z",
  },
  carrier: "IB",
  operating_carrier: "IB",
  self_transfer: false,
  separate_tickets: false,
  airport_changes: false,
  overnight_layover: false,
  checked_bag_included: false,
  carry_on_included: true,
  manual_search_assumptions: {
    max_stops: 2,
    max_layover_hours: 8,
    baggage_profile: "backpack_carryon",
  },
};

const loadCheckedInFixture = async (): Promise<unknown> => {
  const content = await readFile(checkedInFixtureUrl, "utf-8");
  return JSON.parse(content);
};

const buildGateReadyFile = (): RecentDealsBenchmarkFile => ({
  placeholder: false,
  rows: Array.from({ length: 20 }, (_, index) => ({
    ...baseRow,
    departure_date: `2026-09-${String((index % 20) + 1).padStart(2, "0")}`,
    return_date: `2026-10-${String((index % 20) + 1).padStart(2, "0")}`,
    discovered_date: `2026-04-${String((index % 20) + 1).padStart(2, "0")}`,
    source_site: `travel-deals-${index + 1}`,
    source_url: `https://deals.lowroute.dev/deals/${index + 1}`,
  })),
});

describe("recent-deals benchmark validation", () => {
  it("accepts the checked-in placeholder fixture at scaffold level", async () => {
    const fixture = await loadCheckedInFixture();

    expect(validateBenchmarkScaffold(fixture)).toMatchObject({
      ok: true,
    });
  });

  it("rejects the checked-in placeholder fixture at gate-ready level", async () => {
    const fixture = await loadCheckedInFixture();
    const result = validateBenchmarkGateReady(fixture, {
      now: new Date("2026-04-28T00:00:00.000Z"),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain(
        'Benchmark is not gate-ready: "placeholder" is true. Replace rows with 20-30 sanitized real deals (Task 1.2) and set "placeholder": false.',
      );
    }
  });

  it("accepts a gate-ready dataset with 20 recent sanitized rows", () => {
    expect(
      validateBenchmarkGateReady(buildGateReadyFile(), {
        now: new Date("2026-04-28T00:00:00.000Z"),
      }),
    ).toMatchObject({
      ok: true,
    });
  });

  it("rejects impossible calendar dates and impossible UTC instants at scaffold level", () => {
    const result = validateBenchmarkScaffold({
      placeholder: false,
      rows: [
        {
          ...baseRow,
          departure_date: "2026-99-99",
          return_date: "2026-02-31",
          discovered_date: "2026-04-99",
          fx_snapshot: {
            ...baseRow.fx_snapshot,
            captured_at_utc: "2026-99-99T99:99:99Z",
          },
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain(
        "rows[0]: departure_date must be a valid YYYY-MM-DD calendar date",
      );
      expect(result.errors).toContain(
        "rows[0]: return_date must be a valid YYYY-MM-DD calendar date",
      );
      expect(result.errors).toContain(
        "rows[0]: discovered_date must be a valid YYYY-MM-DD calendar date",
      );
      expect(result.errors).toContain(
        "rows[0]: fx_snapshot.captured_at_utc must be an ISO-8601 UTC instant",
      );
    }
  });

  it("accepts UTC instants with variable-length fractional seconds", () => {
    const result = validateBenchmarkScaffold({
      placeholder: false,
      rows: [
        {
          ...baseRow,
          fx_snapshot: {
            ...baseRow.fx_snapshot,
            captured_at_utc: "2026-04-10T15:00:00.1Z",
          },
        },
      ],
    });

    expect(result.ok).toBe(true);
  });

  it("rejects email-shaped tokens in allowed string fields after scaffold validation passes", () => {
    const file = buildGateReadyFile();
    const nestedPercentEncodedEmail =
      "%25252574%25252572%25252561%25252576%25252565%2525256c%25252565%25252572%25252540%25252565%25252578%25252561%2525256d%25252570%2525256c%25252565%2525252e%25252563%2525256f%2525256d";
    file.rows[0] = {
      ...file.rows[0],
      source_url: `https://deals.lowroute.dev/deals/1?bad=%E0%A4%A&ref=${nestedPercentEncodedEmail}`,
    };

    expect(validateBenchmarkScaffold(file)).toMatchObject({
      ok: true,
    });

    const result = validateBenchmarkGateReady(file, {
      now: new Date("2026-04-28T00:00:00.000Z"),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain(
        "rows[0]: string fields must not contain email-shaped tokens",
      );
    }
  });

  it("rejects reserved example.net hostnames at gate-ready level", () => {
    const file = buildGateReadyFile();
    file.rows[0] = {
      ...file.rows[0],
      source_url: "https://travel.example.net./deals/1",
    };

    const result = validateBenchmarkGateReady(file, {
      now: new Date("2026-04-28T00:00:00.000Z"),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain(
        'rows[0]: source_url must not use reserved hostname "example.net"',
      );
    }
  });

  it.each([
    ["127.0.0.2", "127.0.0.2"],
    ["127.2", "127.0.0.2"],
    ["2130706433", "127.0.0.1"],
    ["10.0.0.1", "10.0.0.1"],
    ["100.64.0.1", "100.64.0.1"],
    ["192.0.2.1", "192.0.2.1"],
    ["192.31.196.1", "192.31.196.1"],
    ["192.88.99.1", "192.88.99.1"],
    ["198.18.0.1", "198.18.0.1"],
    ["198.51.100.1", "198.51.100.1"],
    ["203.0.113.1", "203.0.113.1"],
    ["224.0.0.1", "224.0.0.1"],
    ["240.0.0.1", "240.0.0.1"],
  ])("rejects non-public IPv4 source URLs for %s", (hostname, normalizedHostname) => {
    const file = buildGateReadyFile();
    file.rows[0] = {
      ...file.rows[0],
      source_url: `https://${hostname}/deals/1`,
    };

    const result = validateBenchmarkGateReady(file, {
      now: new Date("2026-04-28T00:00:00.000Z"),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain(
        `rows[0]: source_url must not use reserved hostname "${normalizedHostname}"`,
      );
    }
  });

  it("rejects IPv6 loopback hostnames at gate-ready level", () => {
    const file = buildGateReadyFile();
    file.rows[0] = {
      ...file.rows[0],
      source_url: "https://[::1]/deals/1",
    };

    const result = validateBenchmarkGateReady(file, {
      now: new Date("2026-04-28T00:00:00.000Z"),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain('rows[0]: source_url must not use reserved hostname "::1"');
    }
  });

  it.each([
    ["::", "::"],
    ["::127.0.0.1", "::7f00:1"],
    ["::10.0.0.1", "::a00:1"],
    ["64:ff9b::1", "64:ff9b::1"],
    ["100::1", "100::1"],
    ["fc00::1", "fc00::1"],
    ["fe80::1", "fe80::1"],
    ["fec0::1", "fec0::1"],
    ["2001::1", "2001::1"],
    ["2001:2::1", "2001:2::1"],
    ["2001:db8::1", "2001:db8::1"],
    ["2002::1", "2002::1"],
    ["3fff::1", "3fff::1"],
    ["5f00::1", "5f00::1"],
  ])("rejects non-public IPv6 source URLs for %s", (hostname, normalizedHostname) => {
    const file = buildGateReadyFile();
    file.rows[0] = {
      ...file.rows[0],
      source_url: `https://[${hostname}]/deals/1`,
    };

    const result = validateBenchmarkGateReady(file, {
      now: new Date("2026-04-28T00:00:00.000Z"),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain(
        `rows[0]: source_url must not use reserved hostname "${normalizedHostname}"`,
      );
    }
  });

  it("rejects IPv4-mapped IPv6 loopback hostnames at gate-ready level", () => {
    const file = buildGateReadyFile();
    file.rows[0] = {
      ...file.rows[0],
      source_url: "https://[::ffff:127.0.0.1]/deals/1",
    };

    const result = validateBenchmarkGateReady(file, {
      now: new Date("2026-04-28T00:00:00.000Z"),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain(
        'rows[0]: source_url must not use reserved hostname "::ffff"',
      );
    }
  });

  it("rejects undocumented extra row keys before gate-ready PII checks narrow the row", () => {
    const result = validateBenchmarkScaffold({
      placeholder: false,
      rows: [
        {
          ...baseRow,
          notes: "traveler@example.com",
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain('rows[0]: unexpected key "notes" on row');
    }
  });
});
