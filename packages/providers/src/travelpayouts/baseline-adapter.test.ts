import { describe, expect, it } from "vitest";

import {
  parseTravelpayoutsHistoryPayload,
  parseTravelpayoutsTrendPayload,
  TravelpayoutsParseError,
  toBaselineStats,
} from "./baseline-adapter.js";

describe("parseTravelpayoutsHistoryPayload", () => {
  it("uses interpolated p20 for the reference vector [100, 200, 300, 400, 500]", () => {
    const baseline = parseTravelpayoutsHistoryPayload({
      success: true,
      origin: "eze",
      destination: "mad",
      data: {
        "2026-09-01": { price: 500 },
        "2026-09-08": { price: 300 },
        "2026-09-15": { price: 400 },
        "2026-09-22": { price: 200 },
        "2026-09-29": { price: 100 },
      },
    });
    // ! Interpolation at (n - 1) * 0.2 yields 180; the legacy floor-rank method returned 100.
    expect(baseline).toEqual({
      origin: "EZE",
      destination: "MAD",
      p20: 180,
      median: 300,
      sample_size: 5,
    });
  });

  it("maps interpolated p20 and explicit even-sample median to BaselineStats", () => {
    const stats = toBaselineStats(
      parseTravelpayoutsHistoryPayload({
        origin: "EZE",
        destination: "MAD",
        prices: [100, 200],
      }),
    );
    expect(stats.route_key).toBe("EZE-MAD");
    expect(stats.sample_size).toBe(2);
    expect(stats.p20.currency).toBe("USD");
    expect(stats.median.currency).toBe("USD");
    expect(stats.p20.amount).toBe(120);
    expect(stats.median.amount).toBe(150);
  });

  it("rejects helper-shaped history payloads when success is false", () => {
    expect(() =>
      parseTravelpayoutsHistoryPayload({
        success: false,
        origin: "EZE",
        destination: "MAD",
        prices: [100, 200],
      }),
    ).toThrow(/history payload success must be true/);
  });
});

describe("parseTravelpayoutsTrendPayload", () => {
  it("parses a provider matrix envelope with per-record route fields", () => {
    const baseline = parseTravelpayoutsTrendPayload({
      success: true,
      data: [
        { origin: "MIA", destination: "BOG", value: 180 },
        { origin: "MIA", destination: "BOG", value: 220 },
        { origin: "MIA", destination: "BOG", value: 200 },
      ],
    });
    expect(baseline.origin).toBe("MIA");
    expect(baseline.destination).toBe("BOG");
    expect(baseline.sample_size).toBe(3);
    expect(baseline.p20).toBe(188);
    expect(baseline.median).toBe(200);
  });

  it("rejects helper-shaped trend payloads when success is false", () => {
    expect(() =>
      parseTravelpayoutsTrendPayload({
        success: false,
        origin: "MIA",
        destination: "BOG",
        points: [{ price: 180 }, { price: 220 }, { price: 200 }],
      }),
    ).toThrow(/trend payload success must be true/);
  });
});

describe("TravelpayoutsParseError cases", () => {
  it.each([
    ["null root", null],
    ["non-object root", []],
    [
      "invalid root origin length",
      { success: true, origin: "EZ", destination: "MAD", data: { row: { price: 100 } } },
    ],
    [
      "success false",
      { success: false, origin: "EZE", destination: "MAD", data: { row: { price: 100 } } },
    ],
    ["missing route on root and rows", { success: true, data: { "2026-09-01": { price: 100 } } }],
    [
      "row origin conflicts with root route",
      {
        success: true,
        origin: "EZE",
        destination: "MAD",
        data: {
          row: { origin: "AEP", destination: "MAD", price: 100 },
        },
      },
    ],
    [
      "mixed row origins",
      {
        success: true,
        data: [
          { origin: "EZE", destination: "MAD", price: 100 },
          { origin: "AEP", destination: "MAD", price: 120 },
        ],
      },
    ],
    ["missing price records", { success: true, origin: "EZE", destination: "MAD", data: {} }],
    [
      "non-numeric price",
      { success: true, origin: "EZE", destination: "MAD", data: { row: { price: NaN } } },
    ],
    [
      "non-positive price",
      { success: true, origin: "EZE", destination: "MAD", data: { row: { price: 0 } } },
    ],
  ])("history: %s", (_label, payload) => {
    expect(() => parseTravelpayoutsHistoryPayload(payload)).toThrow(TravelpayoutsParseError);
  });

  it.each([
    [
      "success false",
      { success: false, origin: "EZE", destination: "MAD", data: [{ value: 100 }] },
    ],
    ["missing data", { success: true, origin: "EZE", destination: "MAD" }],
    ["empty data", { success: true, origin: "EZE", destination: "MAD", data: [] }],
    [
      "row route conflicts with root route",
      {
        success: true,
        origin: "EZE",
        destination: "MAD",
        data: [{ origin: "MIA", destination: "BOG", value: 100 }],
      },
    ],
    [
      "invalid row origin",
      { success: true, data: [{ origin: "E1E", destination: "MAD", value: 100 }] },
    ],
    [
      "invalid nested value",
      { success: true, origin: "EZE", destination: "MAD", data: [{ value: -1 }] },
    ],
  ])("trend: %s", (_label, payload) => {
    expect(() => parseTravelpayoutsTrendPayload(payload)).toThrow(TravelpayoutsParseError);
  });
});
