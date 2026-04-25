import type { BaselineStats } from "@lowroute/domain";
import { Money } from "@lowroute/domain";

import { getPool } from "../db.js";

export type BaselinesRepository = {
  readonly getByRoute: (routeKey: string) => Promise<BaselineStats | null>;
  readonly upsert: (baseline: BaselineStats) => Promise<void>;
};

export const baselinesRepository: BaselinesRepository = {
  async getByRoute(routeKey) {
    const result = await getPool().query(
      `
        select route_key, p20, median, sample_size
        from route_baselines
        where route_key = $1
      `,
      [routeKey],
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      route_key: row.route_key,
      p20: Money.fromDecimal(Number(row.p20), "USD"),
      median: Money.fromDecimal(Number(row.median), "USD"),
      sample_size: Number(row.sample_size),
    };
  },

  async upsert(baseline) {
    await getPool().query(
      `
        insert into route_baselines (route_key, p20, median, sample_size, updated_at_utc)
        values ($1, $2, $3, $4, now())
        on conflict (route_key) do update set
          p20 = excluded.p20,
          median = excluded.median,
          sample_size = excluded.sample_size,
          updated_at_utc = excluded.updated_at_utc
      `,
      [baseline.route_key, baseline.p20.amount, baseline.median.amount, baseline.sample_size],
    );
  },
};
