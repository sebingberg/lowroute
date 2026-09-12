import { serve } from "@hono/node-server";
import { readEnv } from "@lowroute/config";
import { Hono } from "hono";
import type { PgBoss } from "pg-boss";
import { pino } from "pino";

import { alertsHandler } from "./http/alerts.js";
import { healthHandler } from "./http/health.js";
import { offersHandler } from "./http/offers.js";
import { providerStatusHandler } from "./http/provider-status.js";
import { startWorker } from "./queue.js";

const env = readEnv(process.env);
const logger = pino({ name: "lowroute-service", level: env.LOG_LEVEL });

export const app = new Hono();

app.get("/health", healthHandler);
app.get("/offers", offersHandler);
app.get("/alerts", alertsHandler);
app.get("/provider-status", providerStatusHandler);

if (process.env.NODE_ENV !== "test") {
  const port = env.PORT;
  const server = serve({
    fetch: app.fetch,
    port,
  });
  logger.info({ port }, "service listening");

  let boss: PgBoss | undefined;
  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    const stop = boss
      ? boss.stop().catch((error: unknown) => {
          logger.error({ error }, "worker stop failed");
        })
      : Promise.resolve();
    stop.finally(() => {
      server.close(() => {
        process.exit(0);
      });
    });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  startWorker()
    .then((started) => {
      boss = started;
    })
    .catch((error: unknown) => {
      // ! HTTP stays up so /health keeps reporting; the worker retries on next boot.
      logger.error({ error }, "worker failed to start");
    });
}
