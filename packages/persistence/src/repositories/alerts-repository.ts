import { getPool } from "../db.js";

export type AlertsRepository = {
  readonly wasSentRecently: (alertFingerprint: string, cooldownHours: number) => Promise<boolean>;
  readonly markSent: (alertFingerprint: string, offerFingerprint: string) => Promise<void>;
};

export const alertsRepository: AlertsRepository = {
  async wasSentRecently(alertFingerprint, cooldownHours) {
    const result = await getPool().query(
      `
        select exists(
          select 1 from sent_alerts
          where alert_fingerprint = $1
            and sent_at_utc >= now() - ($2 || ' hours')::interval
        ) as exists
      `,
      [alertFingerprint, String(cooldownHours)],
    );

    return Boolean(result.rows[0]?.exists);
  },

  async markSent(alertFingerprint, offerFingerprint) {
    await getPool().query(
      `
        insert into sent_alerts (alert_fingerprint, offer_fingerprint, sent_at_utc)
        values ($1, $2, now())
        on conflict (alert_fingerprint) do nothing
      `,
      [alertFingerprint, offerFingerprint],
    );
  },
};
