import { readEnv } from "@lowroute/config";
import {
  type BaselineStats,
  buildAlertEligibilityService,
  type NormalizedOffer,
} from "@lowroute/domain";
import { alertsRepository } from "@lowroute/persistence";

export const selectDeals = async (
  offers: NormalizedOffer[],
  baselinesByRoute: ReadonlyMap<string, BaselineStats>,
): Promise<NormalizedOffer[]> => {
  const env = readEnv(process.env);
  const eligibility = buildAlertEligibilityService(env);
  const selected: NormalizedOffer[] = [];

  for (const offer of offers) {
    const baseline = baselinesByRoute.get(`${offer.origin}-${offer.destination}`) ?? null;
    if (
      await eligibility.shouldAlertForDelivery(offer, baseline, {
        telegramChatId: env.TELEGRAM_CHAT_ID,
        alertCooldownHours: env.ALERT_COOLDOWN_HOURS,
        wasSentRecently: alertsRepository.wasSentRecently,
      })
    ) {
      selected.push(offer);
    }
  }

  return selected;
};
