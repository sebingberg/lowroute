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

export const offersHandler = async (context: Context): Promise<Response> => {
  const origin = context.req.query("origin")?.toUpperCase();
  const destination = context.req.query("destination")?.toUpperCase();
  const provider = context.req.query("provider");
  const limit = parseLimit(context.req.query("limit"));

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (origin) {
    params.push(origin);
    conditions.push(`origin = $${params.length}`);
  }
  if (destination) {
    params.push(destination);
    conditions.push(`destination = $${params.length}`);
  }
  if (provider) {
    params.push(provider);
    conditions.push(`provider = $${params.length}`);
  }

  const where = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";
  params.push(limit);

  const result = await getPool().query(
    `
      select
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
      from offers
      ${where}
      order by created_at_utc desc
      limit $${params.length}
    `,
    params,
  );

  return context.json({ offers: result.rows, count: result.rows.length });
};
