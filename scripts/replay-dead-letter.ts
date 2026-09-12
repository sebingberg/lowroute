import PgBoss from "pg-boss";

import {
  parseReplayArgs,
  REPLAY_USAGE,
  replayDeadLetters,
} from "../apps/service/src/dead-letter.js";

const run = async (): Promise<void> => {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`${REPLAY_USAGE}\n`);
    return;
  }
  const replayArgs = parseReplayArgs(args);

  const boss = new PgBoss({
    application_name: "lowroute-replay",
    connectionString:
      process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/lowroute",
    schema: "pgboss",
  });

  await boss.start();
  try {
    await replayDeadLetters(boss, replayArgs, (line) => {
      process.stdout.write(`${line}\n`);
    });
  } finally {
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
  process.stderr.write(`replay failed: ${message}\n`);
  process.exitCode = 1;
});
