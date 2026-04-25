import type { Context } from "hono";

export const healthHandler = (context: Context): Response => {
  return context.json({
    status: "ok",
    service: "lowroute",
    now_utc: new Date().toISOString(),
  });
};
