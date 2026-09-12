import { readEnv } from "@lowroute/config";
import { PgBoss } from "pg-boss";

const QUEUE = "provider-smoke";

const run = async (): Promise<void> => {
  const env = readEnv(process.env);
  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: "pgboss",
    application_name: "lowroute-smoke",
  });

  await boss.start();
  await boss.createQueue(QUEUE);

  let resolveProcessed = (): void => undefined;
  const processed = new Promise<void>((resolve) => {
    resolveProcessed = resolve;
  });

  const workerId = await boss.work<{ ping: string }>(QUEUE, async ([job]) => {
    if (job?.data.ping !== "pong") {
      throw new Error("pg-boss smoke payload mismatch");
    }

    resolveProcessed();
  });

  await boss.send(QUEUE, { ping: "pong" });

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      processed,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("pg-boss smoke timed out")), 5000);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
    await boss.offWork(QUEUE, { id: workerId });
    await boss.stop();
  }
};

run().catch((error: unknown) => {
  const message =
    error instanceof AggregateError
      ? error.errors
          .map((cause) => (cause instanceof Error ? cause.message : String(cause)))
          .join("; ")
      : error instanceof Error
        ? error.message
        : String(error);
  process.stderr.write(`provider smoke failed: ${message}\n`);
  process.exitCode = 1;
});
