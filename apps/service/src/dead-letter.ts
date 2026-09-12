import {
  CHAIN_QUEUES,
  DEAD_LETTER_QUEUE,
  DEFAULT_RETRY_DELAY_SECONDS,
  DEFAULT_RETRY_LIMIT,
  type WorkerBoss,
} from "./queue.js";

export const REPLAY_USAGE =
  "Usage: pnpm replay:dead-letter -- --queue <origin-queue> [--limit <n>] [--dry-run]";

export const REPLAY_DEFAULT_LIMIT = 50;

export type ReplayArgs = {
  readonly dryRun: boolean;
  readonly limit: number;
  readonly originQueue: string;
};

export type ReplayResult = {
  readonly inspected: number;
  readonly replayed: number;
};

export type ReplayBoss = {
  readonly complete: (queue: string, id: string) => Promise<unknown>;
  readonly fetch: <T>(
    queue: string,
    options: { batchSize?: number },
  ) => Promise<{ data: T; id: string }[]>;
  readonly getQueue: (queue: string) => Promise<{ queuedCount: number } | null>;
  readonly send: WorkerBoss["send"];
};

const readFlag = (args: string[], flag: string): string | undefined => {
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) {
    return undefined;
  }
  const value: string | undefined = args[index + 1];
  return value === undefined || value.startsWith("--") ? undefined : value;
};

export const parseReplayArgs = (args: string[]): ReplayArgs => {
  const originQueue = readFlag(args, "--queue");
  if (!originQueue || !(CHAIN_QUEUES as readonly string[]).includes(originQueue)) {
    throw new Error(`--queue must be one of ${CHAIN_QUEUES.join(", ")}\n${REPLAY_USAGE}`);
  }
  // ! parseInt would accept "10junk" or "1.5" and a bare --limit would
  // ! silently fall back to the default, replaying an unintended batch size.
  const limitText = readFlag(args, "--limit");
  if (args.includes("--limit") && limitText === undefined) {
    throw new Error(`--limit must be a positive integer\n${REPLAY_USAGE}`);
  }
  const rawLimit = limitText ?? String(REPLAY_DEFAULT_LIMIT);
  const limit = /^\d+$/.test(rawLimit) ? Number(rawLimit) : Number.NaN;
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error(`--limit must be a positive integer\n${REPLAY_USAGE}`);
  }
  return { dryRun: args.includes("--dry-run"), limit, originQueue };
};

const originOf = (data: unknown): string => {
  if (
    typeof data === "object" &&
    data !== null &&
    "originQueue" in data &&
    typeof (data as { originQueue: unknown }).originQueue === "string"
  ) {
    return (data as { originQueue: string }).originQueue;
  }
  return "unknown";
};

// ! Replay is at-least-once: a crash between send and complete replays the job
// ! again on retry. The send stage stays idempotent via sent_alerts cooldown.
export const replayDeadLetters = async (
  boss: ReplayBoss,
  args: ReplayArgs,
  write: (line: string) => void,
): Promise<ReplayResult> => {
  if (args.dryRun) {
    // ! getQueue is read-only; fetch would take job leases.
    // ! A missing queue row means empty, not an error.
    const size = (await boss.getQueue(DEAD_LETTER_QUEUE))?.queuedCount ?? 0;
    write(`would replay ${size} job(s) from ${DEAD_LETTER_QUEUE} to ${args.originQueue}`);
    return { inspected: size, replayed: 0 };
  }

  const jobs = await boss.fetch<Record<string, unknown>>(DEAD_LETTER_QUEUE, {
    batchSize: args.limit,
  });
  // ! Reject mixed contents before any side effect: every job must belong to
  // ! the explicit destination origin.
  const foreign = jobs.filter((job) => originOf(job.data) !== args.originQueue);
  if (foreign.length > 0) {
    const origins = [...new Set(foreign.map((job) => originOf(job.data)))].join(", ");
    throw new Error(`refusing replay: other origins in dead-letter (${origins})`);
  }
  for (const job of jobs) {
    write(`replaying ${job.id} -> ${args.originQueue}`);
    const replayId = await boss.send(
      args.originQueue,
      { ...(job.data ?? {}) },
      {
        deadLetter: DEAD_LETTER_QUEUE,
        retryBackoff: true,
        retryDelay: DEFAULT_RETRY_DELAY_SECONDS,
        retryLimit: DEFAULT_RETRY_LIMIT,
      },
    );
    if (replayId === null) {
      throw new Error(`replay job was not queued: ${job.id} -> ${args.originQueue}`);
    }
    await boss.complete(DEAD_LETTER_QUEUE, job.id);
  }
  write(`replayed ${jobs.length} job(s) from ${DEAD_LETTER_QUEUE} to ${args.originQueue}`);
  return { inspected: jobs.length, replayed: jobs.length };
};
