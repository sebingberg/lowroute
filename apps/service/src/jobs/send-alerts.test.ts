import {
  buildAlertFingerprint,
  buildOfferFingerprint,
  DEFAULT_ALERT_TEMPLATE_VERSION,
  Money,
  type NormalizedOffer,
} from "@lowroute/domain";
import { afterEach, describe, expect, it, vi } from "vitest";

const { buildTelegramNotifierMock } = vi.hoisted(() => ({
  buildTelegramNotifierMock: vi.fn(),
}));

vi.mock("@lowroute/notifications", () => ({
  buildTelegramNotifier: buildTelegramNotifierMock,
}));

import { sendAlerts } from "./send-alerts.js";

const offer: NormalizedOffer = {
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

afterEach(() => {
  buildTelegramNotifierMock.mockReset();
});

describe("sendAlerts", () => {
  it("records sent alert fingerprints after successful Telegram delivery", async () => {
    const notifier = {
      sendDealAlert: vi.fn().mockResolvedValue(true),
    };
    const alerts = {
      markSent: vi.fn().mockResolvedValue(undefined),
    };
    const offers = {
      upsert: vi.fn().mockResolvedValue(undefined),
    };

    const sentCount = await sendAlerts([offer], {
      env: { TELEGRAM_CHAT_ID: "-100" },
      notifier,
      repositories: { alerts, offers },
    });

    const offerFingerprint = buildOfferFingerprint(offer);
    const alertFingerprint = buildAlertFingerprint(
      offerFingerprint,
      "-100",
      DEFAULT_ALERT_TEMPLATE_VERSION,
    );

    expect(sentCount).toBe(1);
    expect(offers.upsert).toHaveBeenCalledWith(offer);
    expect(alerts.markSent).toHaveBeenCalledWith(alertFingerprint, offerFingerprint);
  });

  it("does not record fingerprints when Telegram delivery is skipped or fails", async () => {
    const alerts = {
      markSent: vi.fn().mockResolvedValue(undefined),
    };
    const offers = {
      upsert: vi.fn().mockResolvedValue(undefined),
    };

    const sentCount = await sendAlerts([offer], {
      env: { TELEGRAM_CHAT_ID: "-100" },
      notifier: { sendDealAlert: vi.fn().mockResolvedValue(false) },
      repositories: { alerts, offers },
    });

    expect(sentCount).toBe(0);
    expect(offers.upsert).toHaveBeenCalledWith(offer);
    expect(alerts.markSent).not.toHaveBeenCalled();
  });

  it("does not call Telegram when offer persistence fails before delivery", async () => {
    const notifier = {
      sendDealAlert: vi.fn().mockResolvedValue(true),
    };
    const alerts = {
      markSent: vi.fn().mockResolvedValue(undefined),
    };
    const offers = {
      upsert: vi.fn().mockRejectedValue(new Error("database unavailable")),
    };

    await expect(
      sendAlerts([offer], {
        env: { TELEGRAM_CHAT_ID: "-100" },
        notifier,
        repositories: { alerts, offers },
      }),
    ).rejects.toThrow("database unavailable");

    expect(notifier.sendDealAlert).not.toHaveBeenCalled();
    expect(alerts.markSent).not.toHaveBeenCalled();
  });

  it("passes the same env into the default notifier used for fingerprinting", async () => {
    const previousChatId = process.env.TELEGRAM_CHAT_ID;
    process.env.TELEGRAM_CHAT_ID = "-999";

    const notifier = {
      sendDealAlert: vi.fn().mockResolvedValue(true),
    };
    buildTelegramNotifierMock.mockReturnValue(notifier);

    const alerts = {
      markSent: vi.fn().mockResolvedValue(undefined),
    };
    const offers = {
      upsert: vi.fn().mockResolvedValue(undefined),
    };

    try {
      const sentCount = await sendAlerts([offer], {
        env: { TELEGRAM_CHAT_ID: "-100" },
        repositories: { alerts, offers },
      });

      const offerFingerprint = buildOfferFingerprint(offer);
      const alertFingerprint = buildAlertFingerprint(
        offerFingerprint,
        "-100",
        DEFAULT_ALERT_TEMPLATE_VERSION,
      );

      expect(sentCount).toBe(1);
      expect(buildTelegramNotifierMock).toHaveBeenCalledWith(
        expect.objectContaining({
          env: expect.objectContaining({ TELEGRAM_CHAT_ID: "-100" }),
        }),
      );
      expect(notifier.sendDealAlert).toHaveBeenCalledWith(offer);
      expect(alerts.markSent).toHaveBeenCalledWith(alertFingerprint, offerFingerprint);
    } finally {
      if (previousChatId === undefined) {
        delete process.env.TELEGRAM_CHAT_ID;
      } else {
        process.env.TELEGRAM_CHAT_ID = previousChatId;
      }
    }
  });

  it("dedupes repeated alert fingerprints within one send run", async () => {
    const notifier = {
      sendDealAlert: vi.fn().mockResolvedValue(true),
    };
    const alerts = {
      markSent: vi.fn().mockResolvedValue(undefined),
    };
    const offers = {
      upsert: vi.fn().mockResolvedValue(undefined),
    };

    const sentCount = await sendAlerts([offer, { ...offer }], {
      env: { TELEGRAM_CHAT_ID: "-100" },
      notifier,
      repositories: { alerts, offers },
    });

    expect(sentCount).toBe(1);
    expect(notifier.sendDealAlert).toHaveBeenCalledTimes(1);
    expect(offers.upsert).toHaveBeenCalledTimes(1);
    expect(alerts.markSent).toHaveBeenCalledTimes(1);
  });
});
