import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { pino } from "pino";

import { readEnv } from "@lowroute/config";

import { alertsHandler } from "./http/alerts.js";
import { healthHandler } from "./http/health.js";
import { offersHandler } from "./http/offers.js";
import { providerStatusHandler } from "./http/provider-status.js";

const env = readEnv(process.env);
const logger = pino({ name: "lowroute-service", level: env.LOG_LEVEL });

export const app = new Hono();

app.get("/health", healthHandler);
app.get("/offers", offersHandler);
app.get("/alerts", alertsHandler);
app.get("/provider-status", providerStatusHandler);

if (process.env.NODE_ENV !== "test") {
  const port = env.PORT;
  serve({
    fetch: app.fetch,
    port,
  });
  logger.info({ port }, "service listening");
}
