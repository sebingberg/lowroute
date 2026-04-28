import { type Env, readEnv } from "@lowroute/config";
import {
  buildAlertFingerprint,
  buildOfferFingerprint,
  DEFAULT_ALERT_TEMPLATE_VERSION,
  type NormalizedOffer,
} from "@lowroute/domain";
import { buildTelegramNotifier, type TelegramNotifier } from "@lowroute/notifications";
import { alertsRepository, offersRepository } from "@lowroute/persistence";
import { pino } from "pino";

const logger = pino({ name: "lowroute-send-alerts" });

export type SendAlertsOptions = {
  readonly env?: Partial<Env>;
  readonly notifier?: TelegramNotifier;
  readonly repositories?: {
    readonly alerts: Pick<typeof alertsRepository, "markSent">;
    readonly offers: Pick<typeof offersRepository, "upsert">;
  };
};

export const sendAlerts = async (
  offers: NormalizedOffer[],
  options: SendAlertsOptions = {},
): Promise<number> => {
  const env: Env = { ...readEnv(process.env), ...options.env };
  const notifier = options.notifier ?? buildTelegramNotifier({ logger, env });
  const repositories = options.repositories ?? {
    alerts: alertsRepository,
    offers: offersRepository,
  };
  let sentCount = 0;
  const seenAlertFingerprints = new Set<string>();

  for (const offer of offers) {
    const offerFingerprint = buildOfferFingerprint(offer);
    const alertFingerprint = buildAlertFingerprint(
      offerFingerprint,
      env.TELEGRAM_CHAT_ID,
      DEFAULT_ALERT_TEMPLATE_VERSION,
    );

    // ! This is best-effort batch dedupe only; cross-run claiming still needs DB coordination.
    if (seenAlertFingerprints.has(alertFingerprint)) {
      continue;
    }
    seenAlertFingerprints.add(alertFingerprint);

    await repositories.offers.upsert(offer);
    const sent = await notifier.sendDealAlert(offer);
    if (sent) {
      await repositories.alerts.markSent(alertFingerprint, offerFingerprint);
      sentCount += 1;
    }
  }

  return sentCount;
};
