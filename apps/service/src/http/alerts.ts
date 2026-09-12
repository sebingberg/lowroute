import { getPool } from "@lowroute/persistence";
import type { Context } from "hono";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const parseLimit = (raw: string | undefined): number => {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_LIMIT;
  }
  return Math.min(Math.max(parsed, 1), MAX_LIMIT);
};

export const alertsHandler = async (context: Context): Promise<Response> => {
  const limit = parseLimit(context.req.query("limit"));

  const result = await getPool().query(
    `
      select
        s.alert_fingerprint,
        s.offer_fingerprint,
        s.sent_at_utc,
        to_jsonb(o) as offer
      from sent_alerts s
      left join offers o on o.offer_fingerprint = s.offer_fingerprint
      order by s.sent_at_utc desc
      limit $1
    `,
    [limit],
  );

  return context.json({ alerts: result.rows, count: result.rows.length });
};
