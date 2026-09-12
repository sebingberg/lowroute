import { randomUUID } from "node:crypto";
import { readEnv } from "@lowroute/config";
import type { NormalizedOffer } from "@lowroute/domain";
import type { NormalizedSearchRequest } from "@lowroute/providers";
import {
  type Queue as BossQueue,
  type ScheduleOptions as BossScheduleOptions,
  type SendOptions as BossSendOptions,
  PgBoss,
} from "pg-boss";
import { pino } from "pino";

import { type Candidate, discoverCandidates } from "./jobs/discover-candidates.js";
import { scoreOffers } from "./jobs/score-offers.js";
import { selectDeals } from "./jobs/select-deals.js";
import { sendAlerts } from "./jobs/send-alerts.js";

export const DISCOVER_QUEUE = "lowroute.discover";
export const FETCH_QUEUE = "lowroute.fetch";
export const SCORE_QUEUE = "lowroute.score";
export const SELECT_QUEUE = "lowroute.select";
export const SEND_QUEUE = "lowroute.send";
export const DEAD_LETTER_QUEUE = "lowroute.dead-letter";

export const CHAIN_QUEUES = [
  DISCOVER_QUEUE,
  FETCH_QUEUE,
  SCORE_QUEUE,
  SELECT_QUEUE,
  SEND_QUEUE,
] as const;

// ! Keep retry/dead-letter policy here so the replay script reuses the same values.
export const DEFAULT_RETRY_LIMIT = 5;
export const DEFAULT_RETRY_DELAY_SECONDS = 30;
export const DEFAULT_DISCOVERY_INTERVAL_MIN = 360;

export type DiscoverJobData = {
  readonly originQueue: string;
  readonly runId: string;
  readonly triggeredAt: string;
};

export type FetchJobData = {
  readonly candidates: Candidate[];
  readonly originQueue: string;
  readonly runId: string;
};

export type ScoreJobData = {
  readonly offers: NormalizedOffer[];
  readonly originQueue: string;
  readonly runId: string;
};

export type SelectJobData = {
  readonly offers: NormalizedOffer[];
  readonly originQueue: string;
  readonly runId: string;
};

export type SendJobData = {
  readonly deals: NormalizedOffer[];
  readonly originQueue: string;
  readonly runId: string;
};

export type QueueJob = {
  readonly data: unknown;
  readonly id: string;
  readonly name: string;
};

export type WorkerLogger = {
  readonly error: (payload: Record<string, unknown>, message: string) => void;
  readonly info: (payload: Record<string, unknown>, message: string) => void;
};

export type WorkerBoss = {
  readonly createQueue: (name: string, options?: BossQueue) => Promise<void>;
  readonly schedule: (
    name: string,
    cron: string,
    data?: object,
    options?: BossScheduleOptions,
  ) => Promise<void>;
  readonly send: (
    name: string,
    data: Record<string, unknown>,
    options?: BossSendOptions,
  ) => Promise<string | null>;
  readonly work: (name: string, handler: (jobs: QueueJob[]) => Promise<unknown>) => Promise<string>;
};

export type ChainSteps = {
  readonly discover: () => Candidate[];
  readonly fetch: (candidates: Candidate[]) => Promise<NormalizedOffer[]>;
  readonly score: (offers: NormalizedOffer[]) => NormalizedOffer[];
  readonly select: (offers: NormalizedOffer[]) => Promise<NormalizedOffer[]>;
  readonly send: (deals: NormalizedOffer[]) => Promise<number>;
};

const workerLogger = pino({ name: "lowroute-worker" });

const sendOptions = (): BossSendOptions => ({
  deadLetter: DEAD_LETTER_QUEUE,
  retryBackoff: true,
  retryDelay: DEFAULT_RETRY_DELAY_SECONDS,
  retryLimit: DEFAULT_RETRY_LIMIT,
});

const addDaysToDateOnly = (dateOnly: string, days: number): string => {
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const toSearchRequest = (
  candidate: Candidate,
  maxLayoverHours: number,
): NormalizedSearchRequest => ({
  adults: 1,
  cabin: "economy",
  departure_date: candidate.departure_date,
  destination: candidate.destination,
  max_layover_hours: maxLayoverHours,
  origin: candidate.origin,
  return_date: addDaysToDateOnly(candidate.departure_date, candidate.max_trip_days),
});

// ! Plan A landed live probes, but provider→domain normalization does not exist
// ! yet. Fanning out fetchOffers here would burn provider quota and drop every
// ! result, so the fetch step validates search construction against the real
// ! contract and yields no offers until normalization lands.
const fetchStubOffers = async (candidates: Candidate[]): Promise<NormalizedOffer[]> => {
  const env = readEnv(process.env);
  for (const candidate of candidates) {
    // ! Result intentionally discarded: construction type-checks the request
    // ! contract per candidate while sending nothing (see comment above).
    toSearchRequest(candidate, env.MAX_LAYOVER_HOURS);
  }
  return [];
};

export const defaultSteps: ChainSteps = {
  discover: () => discoverCandidates(),
  fetch: (candidates) => fetchStubOffers(candidates),
  score: (offers) => scoreOffers(offers),
  // ! Stub until Plan A lands: empty baselines force baseline=null, so selection
  // ! currently applies cooldown gating only. Replace with a baseline-repository
  // ! lookup before wiring real provider fetch.
  select: (offers) => selectDeals(offers, new Map()),
  send: (deals) => sendAlerts(deals),
};

export const resolveDiscoveryIntervalMin = (input: NodeJS.ProcessEnv = process.env): number => {
  // ! parseInt would truncate "1.5" to 1 or "45minutes" to 45; only a full
  // ! digit string counts as an explicit setting, anything else falls back.
  const raw = input.WORKER_DISCOVERY_INTERVAL_MIN ?? "";
  if (!/^\d+$/.test(raw)) {
    return DEFAULT_DISCOVERY_INTERVAL_MIN;
  }
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_DISCOVERY_INTERVAL_MIN;
};

export const discoveryCron = (intervalMin: number): string => {
  if (!Number.isInteger(intervalMin) || intervalMin <= 0) {
    throw new RangeError(`WORKER_DISCOVERY_INTERVAL_MIN must be a positive integer`);
  }
  if (intervalMin < 60) {
    // ! cron minute steps reset each hour, so 45 would run at :45 then :00
    // ! (a 15-minute gap). Only admit steps that divide the hour evenly.
    if (60 % intervalMin !== 0) {
      throw new RangeError(
        `WORKER_DISCOVERY_INTERVAL_MIN=${intervalMin} has no exact cron form (sub-hour values must divide 60)`,
      );
    }
    return `*/${intervalMin} * * * *`;
  }
  if (intervalMin === 24 * 60) {
    return "0 0 * * *";
  }
  if (intervalMin < 24 * 60 && intervalMin % 60 === 0) {
    return `0 */${intervalMin / 60} * * *`;
  }
  throw new RangeError(
    `WORKER_DISCOVERY_INTERVAL_MIN=${intervalMin} has no exact cron form (use <60, an hourly multiple, or 1440)`,
  );
};

const sendNext = async (
  boss: WorkerBoss,
  logger: WorkerLogger,
  queue: string,
  data: Record<string, unknown>,
  context: Record<string, unknown>,
): Promise<void> => {
  const nextJobId = await boss.send(queue, data, sendOptions());
  if (nextJobId === null) {
    logger.error({ queue, ...context }, "chained job was not queued");
    // ! Throw so pg-boss retries with backoff, then dead-letters. Resolving
    // ! here would silently drop the rest of the chain.
    throw new Error(`chained job was not queued: ${queue}`);
  }
};

export const registerWorker = async (
  boss: WorkerBoss,
  steps: ChainSteps = defaultSteps,
  logger: WorkerLogger = workerLogger,
): Promise<void> => {
  // ! The dead-letter queue must exist before chain queues reference it (pg-boss FK).
  await boss.createQueue(DEAD_LETTER_QUEUE, { name: DEAD_LETTER_QUEUE });
  for (const name of CHAIN_QUEUES) {
    await boss.createQueue(name, { name, ...sendOptions() });
  }

  await boss.work(DISCOVER_QUEUE, async (jobs) => {
    for (const job of jobs) {
      const data = job.data as DiscoverJobData;
      // ! triggeredAt is restamped at fire time; the scheduled payload carries boot time.
      const firedAt = new Date().toISOString();
      const runId = `${data.runId}:${job.id}`;
      logger.info(
        { jobId: job.id, queue: DISCOVER_QUEUE, runId, triggeredAt: firedAt },
        "discover started",
      );
      const candidates = steps.discover();
      await sendNext(
        boss,
        logger,
        FETCH_QUEUE,
        { candidates, originQueue: FETCH_QUEUE, runId },
        { jobId: job.id, runId },
      );
      logger.info(
        { candidateCount: candidates.length, jobId: job.id, queue: DISCOVER_QUEUE, runId },
        "discover completed",
      );
    }
  });

  await boss.work(FETCH_QUEUE, async (jobs) => {
    for (const job of jobs) {
      const data = job.data as FetchJobData;
      logger.info(
        {
          candidateCount: data.candidates.length,
          jobId: job.id,
          queue: FETCH_QUEUE,
          runId: data.runId,
        },
        "fetch started",
      );
      const offers = await steps.fetch(data.candidates);
      await sendNext(
        boss,
        logger,
        SCORE_QUEUE,
        { offers, originQueue: SCORE_QUEUE, runId: data.runId },
        { jobId: job.id },
      );
      logger.info(
        { jobId: job.id, offerCount: offers.length, queue: FETCH_QUEUE, runId: data.runId },
        "fetch completed",
      );
    }
  });

  await boss.work(SCORE_QUEUE, async (jobs) => {
    for (const job of jobs) {
      const data = job.data as ScoreJobData;
      logger.info(
        { jobId: job.id, offerCount: data.offers.length, queue: SCORE_QUEUE, runId: data.runId },
        "score started",
      );
      const offers = steps.score(data.offers);
      await sendNext(
        boss,
        logger,
        SELECT_QUEUE,
        { offers, originQueue: SELECT_QUEUE, runId: data.runId },
        { jobId: job.id },
      );
      logger.info(
        { jobId: job.id, offerCount: offers.length, queue: SCORE_QUEUE, runId: data.runId },
        "score completed",
      );
    }
  });

  await boss.work(SELECT_QUEUE, async (jobs) => {
    for (const job of jobs) {
      const data = job.data as SelectJobData;
      logger.info(
        { jobId: job.id, offerCount: data.offers.length, queue: SELECT_QUEUE, runId: data.runId },
        "select started",
      );
      const deals = await steps.select(data.offers);
      await sendNext(
        boss,
        logger,
        SEND_QUEUE,
        { deals, originQueue: SEND_QUEUE, runId: data.runId },
        { jobId: job.id },
      );
      logger.info(
        { dealCount: deals.length, jobId: job.id, queue: SELECT_QUEUE, runId: data.runId },
        "select completed",
      );
    }
  });

  await boss.work(SEND_QUEUE, async (jobs) => {
    for (const job of jobs) {
      const data = job.data as SendJobData;
      logger.info(
        { dealCount: data.deals.length, jobId: job.id, queue: SEND_QUEUE, runId: data.runId },
        "send started",
      );
      const sentCount = await steps.send(data.deals);
      logger.info(
        {
          dealCount: data.deals.length,
          jobId: job.id,
          queue: SEND_QUEUE,
          runId: data.runId,
          sentCount,
        },
        "send completed",
      );
    }
  });
};

export const startWorker = async (
  connectionString: string = process.env.DATABASE_URL ??
    "postgres://postgres:postgres@localhost:5432/lowroute",
): Promise<PgBoss> => {
  const boss = new PgBoss({
    application_name: "lowroute-worker",
    connectionString,
    schema: "pgboss",
  });
  boss.on("error", (error: Error) => {
    workerLogger.error({ error: error.message }, "pg-boss error");
  });
  await boss.start();
  await registerWorker(boss);
  const intervalMin = resolveDiscoveryIntervalMin();
  const triggeredAt = new Date().toISOString();
  await boss.schedule(
    DISCOVER_QUEUE,
    discoveryCron(intervalMin),
    { originQueue: DISCOVER_QUEUE, runId: "scheduled", triggeredAt },
    sendOptions(),
  );
  const runId = randomUUID();
  // ! Stable singleton key: concurrent boots enqueue a single kickoff run.
  // ! A deduped (null) kickoff is fine; the worker still serves scheduled ticks.
  await boss.send(
    DISCOVER_QUEUE,
    { originQueue: DISCOVER_QUEUE, runId, triggeredAt },
    {
      ...sendOptions(),
      singletonKey: "lowroute.discover:boot",
      singletonSeconds: intervalMin * 60,
    },
  );
  workerLogger.info({ intervalMin, runId }, "worker started");
  return boss;
};
