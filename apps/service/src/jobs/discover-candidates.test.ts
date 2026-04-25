import { describe, expect, it } from "vitest";

import { discoverCandidates } from "./discover-candidates.js";

describe("discoverCandidates", () => {
  it("emits deterministic dated candidates and honors EPA flag", () => {
    const candidates = discoverCandidates({
      env: {
        ALLOWED_ORIGINS: ["EZE", "EPA"],
        ENABLE_EPA: false,
      },
      now: new Date("2026-04-25T00:00:00.000Z"),
    });

    expect(candidates[0]).toMatchObject({
      departure_date: "2026-05-25",
      origin: "EZE",
    });
    expect(candidates.some((candidate) => candidate.origin === "EPA")).toBe(false);
  });
});
