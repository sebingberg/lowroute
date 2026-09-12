import { describe, expect, it, vi } from "vitest";

import { redactUrl, requestJson, resolveApiKey } from "./http.js";

describe("redactUrl", () => {
  it("masks token-like query params while keeping the rest of the URL", () => {
    expect(redactUrl("https://x.test/p?origin=EZE&token=secret&currency=USD")).toBe(
      "https://x.test/p?origin=EZE&token=***&currency=USD",
    );
    expect(redactUrl("https://x.test/p?apikey=secret")).toBe("https://x.test/p?apikey=***");
    expect(redactUrl("https://x.test/p?access_key=secret&signature=abc")).toBe(
      "https://x.test/p?access_key=***&signature=***",
    );
    expect(redactUrl("https://x.test/p?secret=top")).toBe("https://x.test/p?secret=***");
    expect(redactUrl("https://x.test/p?origin=EZE")).toBe("https://x.test/p?origin=EZE");
  });
});

describe("resolveApiKey", () => {
  it("treats empty string as missing even when the env var is set", () => {
    const saved = process.env.DUFFEL_API_KEY;
    process.env.DUFFEL_API_KEY = "env-key";
    try {
      resolveApiKey("duffel", "DUFFEL_API_KEY", "");
      expect.unreachable("empty apiKey must throw");
    } catch (error) {
      expect(error).toMatchObject({ code: "missing_credentials" });
    } finally {
      if (saved === undefined) {
        delete process.env.DUFFEL_API_KEY;
      } else {
        process.env.DUFFEL_API_KEY = saved;
      }
    }
  });
});

describe("requestJson", () => {
  it("redacts the token and strips the body from failure messages", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => ({
      ok: false,
      status: 500,
      json: async () => ({}),
      text: async () => '{"error":"bad token=live-secret"}',
    }));

    const error = await requestJson(
      "https://api.travelpayouts.com/v1/prices/cheap?origin=EZE&token=live-secret",
      {
        provider: "travelpayouts",
        method: "GET",
        headers: {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    ).catch((cause: unknown) => cause);

    expect(error).toMatchObject({ code: "bad_response" });
    const message = error instanceof Error ? error.message : String(error);
    expect(message).toContain("token=***");
    expect(message).not.toContain("live-secret");
  });

  it("maps a timeout during body parsing to retryable timeout", async () => {
    const timeoutError = new Error("The operation timed out");
    timeoutError.name = "TimeoutError";
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => {
        throw timeoutError;
      },
    }));

    const error = await requestJson("https://api.duffel.com/air/offer_requests", {
      provider: "duffel",
      method: "POST",
      headers: {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).catch((cause: unknown) => cause);

    expect(error).toMatchObject({ code: "timeout", retryable: true });
  });
});
