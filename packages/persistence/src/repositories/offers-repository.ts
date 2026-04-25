import type { NormalizedOffer } from "@lowroute/domain";

import { getPool } from "../db.js";

export type OffersRepository = {
  readonly upsert: (offer: NormalizedOffer, offerFingerprint: string) => Promise<void>;
};

export const offersRepository: OffersRepository = {
  async upsert(offer, offerFingerprint) {
    await getPool().query(
      `
        insert into offers (
          offer_fingerprint,
          provider,
          origin,
          destination,
          departure_date,
          return_date,
          normalized_payable_usd,
          currency,
          quoted_amount,
          risk_flags,
          created_at_utc
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb, now())
        on conflict (offer_fingerprint) do update set
          normalized_payable_usd = excluded.normalized_payable_usd,
          quoted_amount = excluded.quoted_amount,
          risk_flags = excluded.risk_flags
      `,
      [
        offerFingerprint,
        offer.provider,
        offer.origin,
        offer.destination,
        offer.departure_date,
        offer.return_date,
        offer.normalized_payable.amount,
        offer.quoted_price.currency,
        offer.quoted_price.amount,
        JSON.stringify({
          self_transfer: offer.self_transfer,
          separate_tickets: offer.separate_tickets,
          airport_change: offer.airport_change,
          overnight_layover: offer.overnight_layover,
          checked_bag_included: offer.checked_bag_included,
        }),
      ],
    );
  },
};
