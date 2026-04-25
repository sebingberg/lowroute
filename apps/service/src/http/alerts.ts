import type { Context } from "hono";

export const alertsHandler = (context: Context): Response => {
  return context.json({
    alerts: [],
    count: 0,
  });
};
