import { readEnv } from "@lowroute/config";
import type { NormalizedOffer } from "@lowroute/domain";
import { Money } from "@lowroute/domain";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildTelegramNotifier } from "./telegram-notifier.js";

const sampleOffer: NormalizedOffer = {
  provider: "duffel",
  origin: "EZE",
  destination: "MIA",
  departure_date: "2026-10-10",
  return_date: "2026-11-01",
  trip_days: 22,
  destination_tier: "far",
  cabin: "economy",
  max_layover_hours: 4,
  self_transfer: false,
  separate_tickets: false,
  airport_change: false,
  overnight_layover: false,
  checked_bag_included: false,
  carry_on_included: true,
  connection_minutes_min: 100,
  merchant_country: "US",
  quoted_price: Money.fromDecimal(550, "USD"),
  normalized_payable: Money.fromDecimal(550, "USD"),
  payment_path: "foreign_card",
  score: 900,
};

const liveSendEnv = () =>
  readEnv({
    NODE_ENV: "test",
    DATABASE_URL: "postgres://localhost:5432/lowroute",
    TELEGRAM_BOT_TOKEN: "test-token",
    TELEGRAM_CHAT_ID: "99",
    TELEGRAM_ALERTS_ENABLED: "true",
    ALERT_DRY_RUN: "false",
  });

describe("buildTelegramNotifier", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("logs rendered payload and does not call fetch when ALERT_DRY_RUN is true", async () => {
    const env = readEnv({
      NODE_ENV: "test",
      DATABASE_URL: "postgres://localhost:5432/lowroute",
      TELEGRAM_ALERTS_ENABLED: "true",
      ALERT_DRY_RUN: "true",
    });
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const info = vi.fn();
    const notifier = buildTelegramNotifier({ env, logger: { info, warn: vi.fn() } });
    const ok = await notifier.sendDealAlert(sampleOffer);

    expect(ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]?.[1]).toBe("telegram alert dry run");
    expect(String(info.mock.calls[0]?.[0]?.message)).toContain("EZE");
  });

  it("logs rendered payload and does not call fetch when TELEGRAM_ALERTS_ENABLED is false", async () => {
    const env = readEnv({
      NODE_ENV: "test",
      DATABASE_URL: "postgres://localhost:5432/lowroute",
      TELEGRAM_ALERTS_ENABLED: "false",
      ALERT_DRY_RUN: "false",
    });
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const info = vi.fn();
    const notifier = buildTelegramNotifier({ env, logger: { info, warn: vi.fn() } });
    await notifier.sendDealAlert(sampleOffer);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.any(String), offer: sampleOffer }),
      "telegram alert dry run",
    );
  });

  it("returns true on first 2xx response", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "{}",
    });
    globalThis.fetch = fetchSpy;

    const notifier = buildTelegramNotifier({ env: liveSendEnv(), retryCount: 0 });
    const ok = await notifier.sendDealAlert(sampleOffer);

    expect(ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0] ?? [];
    expect(init).toMatchObject({ method: "POST" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("logs non-2xx with status and body, retries, then succeeds", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        text: async () => "bad gateway",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "{}",
      });
    globalThis.fetch = fetchSpy;

    const warn = vi.fn();
    const notifier = buildTelegramNotifier({
      env: liveSendEnv(),
      logger: { info: vi.fn(), warn },
      retryCount: 2,
    });
    const ok = await notifier.sendDealAlert(sampleOffer);

    expect(ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatchObject({
      attempt: 0,
      status: 502,
      responseText: "bad gateway",
    });
    expect(warn.mock.calls[0]?.[1]).toBe("telegram send failed");
  });

  it("returns false after exhausting retries on repeated non-2xx", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "rate limited",
    });
    globalThis.fetch = fetchSpy;

    const warn = vi.fn();
    const notifier = buildTelegramNotifier({
      env: liveSendEnv(),
      logger: { info: vi.fn(), warn },
      retryCount: 1,
    });
    const ok = await notifier.sendDealAlert(sampleOffer);

    expect(ok).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.every((c) => c[1] === "telegram send failed")).toBe(true);
  });

  it("logs transport errors and retries until failure", async () => {
    const err = new TypeError("network down");
    const fetchSpy = vi.fn().mockRejectedValue(err);
    globalThis.fetch = fetchSpy;

    const warn = vi.fn();
    const notifier = buildTelegramNotifier({
      env: liveSendEnv(),
      logger: { info: vi.fn(), warn },
      retryCount: 1,
    });
    const ok = await notifier.sendDealAlert(sampleOffer);

    expect(ok).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.every((c) => c[1] === "telegram send errored")).toBe(true);
    expect(warn.mock.calls.map((c) => c[0])).toEqual([
      expect.objectContaining({ attempt: 0, error: err }),
      expect.objectContaining({ attempt: 1, error: err }),
    ]);
  });

  it("passes timeout to fetch via AbortSignal", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    let receivedSignal: AbortSignal | undefined;
    const fetchSpy = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      const s = init?.signal;
      receivedSignal = s ?? undefined;
      return Promise.resolve({ ok: true, status: 200, text: async () => "{}" });
    });
    globalThis.fetch = fetchSpy;

    const notifier = buildTelegramNotifier({
      env: liveSendEnv(),
      timeoutMs: 12_345,
      retryCount: 0,
    });
    await notifier.sendDealAlert(sampleOffer);

    expect(timeoutSpy).toHaveBeenCalledWith(12_345);
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(receivedSignal?.aborted).toBe(false);
  });
});
