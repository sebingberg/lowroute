import { getProviderStatusPayload } from "@lowroute/domain";
import type { Context } from "hono";

export const providerStatusHandler = (context: Context): Response => {
  return context.json(getProviderStatusPayload());
};
