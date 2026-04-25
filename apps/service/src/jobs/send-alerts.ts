import type { NormalizedOffer } from "@lowroute/domain";
import { buildTelegramNotifier } from "@lowroute/notifications";
import { pino } from "pino";

const logger = pino({ name: "lowroute-send-alerts" });

export const sendAlerts = async (offers: NormalizedOffer[]): Promise<number> => {
  const notifier = buildTelegramNotifier({ logger });
  let sentCount = 0;

  for (const offer of offers) {
    const sent = await notifier.sendDealAlert(offer);
    if (sent) {
      sentCount += 1;
    }
  }

  return sentCount;
};
