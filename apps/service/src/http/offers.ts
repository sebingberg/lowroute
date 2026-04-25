import type { Context } from "hono";

export const offersHandler = (context: Context): Response => {
  return context.json({
    offers: [],
    count: 0,
  });
};
