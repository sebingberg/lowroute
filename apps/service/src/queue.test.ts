import { describe, expect, it } from "vitest";

import {
  CHAIN_QUEUES,
  type ChainSteps,
  DEAD_LETTER_QUEUE,
  DEFAULT_DISCOVERY_INTERVAL_MIN,
  DISCOVER_QUEUE,
  discoveryCron,
  FETCH_QUEUE,
  type FetchJobData,
  type QueueJob,
  registerWorker,
  resolveDiscoveryIntervalMin,
  SCORE_QUEUE,
  type ScoreJobData,
  SELECT_QUEUE,
  SEND_QUEUE,
  type SelectJobData,
  type SendJobData,
  type WorkerBoss,
} from "./queue.js";

const silentLogger = {
  error: () => undefined,
  info: () => undefined,
};

const job = (name: string, data: unknown, id = "job-1"): QueueJob => ({ data, id, name });

const createFakeBoss = (sendResult: string | null = "job-id") => {
  const created: { name: string; options?: object }[] = [];
  const handlers = new Map<string, (jobs: QueueJob[]) => Promise<unknown>>();
  const sent: { data: Record<string, unknown>; name: string }[] = [];
  const scheduled: { cron: string; name: string }[] = [];
  const boss: WorkerBoss = {
    createQueue: async (name, options) => {
      created.push({ name, options });
    },
    schedule: async (name, cron) => {
      scheduled.push({ cron, name });
    },
    send: async (name, data) => {
      sent.push({ data, name });
      return sendResult;
    },
    work: async (name, handler) => {
      handlers.set(name, handler);
      return `worker-${name}`;
    },
  };
  return { boss, created, handlers, scheduled, sent };
};

const stubSteps = (overrides: Partial<ChainSteps> = {}): ChainSteps & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    discover: () => {
      calls.push("discover");
      return [];
    },
    fetch: async () => {
      calls.push("fetch");
      return [];
    },
    score: (offers) => {
      calls.push("score");
      return offers;
    },
    select: async (offers) => {
      calls.push("select");
      return offers;
    },
    send: async () => {
      calls.push("send");
      return 0;
    },
    ...overrides,
  };
};

describe("resolveDiscoveryIntervalMin", () => {
  it("defaults when unset", () => {
    expect(resolveDiscoveryIntervalMin({})).toBe(DEFAULT_DISCOVERY_INTERVAL_MIN);
  });

  it("parses valid values", () => {
    expect(resolveDiscoveryIntervalMin({ WORKER_DISCOVERY_INTERVAL_MIN: "45" })).toBe(45);
  });

  it("falls back on invalid values", () => {
    expect(resolveDiscoveryIntervalMin({ WORKER_DISCOVERY_INTERVAL_MIN: "0" })).toBe(
      DEFAULT_DISCOVERY_INTERVAL_MIN,
    );
    expect(resolveDiscoveryIntervalMin({ WORKER_DISCOVERY_INTERVAL_MIN: "-5" })).toBe(
      DEFAULT_DISCOVERY_INTERVAL_MIN,
    );
    expect(resolveDiscoveryIntervalMin({ WORKER_DISCOVERY_INTERVAL_MIN: "soon" })).toBe(
      DEFAULT_DISCOVERY_INTERVAL_MIN,
    );
    // ! parseInt-style truncation must not apply: these are not explicit settings.
    expect(resolveDiscoveryIntervalMin({ WORKER_DISCOVERY_INTERVAL_MIN: "1.5" })).toBe(
      DEFAULT_DISCOVERY_INTERVAL_MIN,
    );
    expect(resolveDiscoveryIntervalMin({ WORKER_DISCOVERY_INTERVAL_MIN: "45minutes" })).toBe(
      DEFAULT_DISCOVERY_INTERVAL_MIN,
    );
    expect(resolveDiscoveryIntervalMin({ WORKER_DISCOVERY_INTERVAL_MIN: "10junk" })).toBe(
      DEFAULT_DISCOVERY_INTERVAL_MIN,
    );
  });
});

describe("discoveryCron", () => {
  it("uses minute steps under an hour", () => {
    expect(discoveryCron(15)).toBe("*/15 * * * *");
  });

  it("uses exact hourly steps and daily for 1440", () => {
    expect(discoveryCron(60)).toBe("0 */1 * * *");
    expect(discoveryCron(360)).toBe("0 */6 * * *");
    expect(discoveryCron(1440)).toBe("0 0 * * *");
  });

  it("rejects intervals with no exact cron form", () => {
    expect(() => discoveryCron(0)).toThrow(RangeError);
    expect(() => discoveryCron(-5)).toThrow(RangeError);
    expect(() => discoveryCron(90)).toThrow(RangeError);
    expect(() => discoveryCron(1500)).toThrow(RangeError);
    // ! Minute steps reset each hour; 7 and 45 would drift off-cadence.
    expect(() => discoveryCron(7)).toThrow(RangeError);
    expect(() => discoveryCron(45)).toThrow(RangeError);
  });
});

describe("registerWorker", () => {
  it("creates the dead-letter queue before chain queues with retry policy", async () => {
    const { boss, created, handlers } = createFakeBoss();

    await registerWorker(boss, stubSteps(), silentLogger);

    expect(created[0]?.name).toBe(DEAD_LETTER_QUEUE);
    expect(created.map((entry) => entry.name).slice(1)).toEqual([...CHAIN_QUEUES]);
    for (const entry of created.slice(1)) {
      expect(entry.options).toMatchObject({
        deadLetter: DEAD_LETTER_QUEUE,
        retryBackoff: true,
        retryLimit: 5,
      });
    }
    expect([...handlers.keys()].sort()).toEqual(
      [DISCOVER_QUEUE, FETCH_QUEUE, SCORE_QUEUE, SELECT_QUEUE, SEND_QUEUE].sort(),
    );
  });

  it("chains discover -> fetch -> score -> select -> send", async () => {
    const { boss, handlers, sent } = createFakeBoss();
    const steps = stubSteps();
    await registerWorker(boss, steps, silentLogger);

    await handlers.get(DISCOVER_QUEUE)?.([
      job(DISCOVER_QUEUE, {
        originQueue: DISCOVER_QUEUE,
        runId: "run-1",
        triggeredAt: "2026-09-12T00:00:00.000Z",
      }),
    ]);
    expect(sent).toHaveLength(1);
    const fetchSent = sent[0];
    expect(fetchSent?.name).toBe(FETCH_QUEUE);

    await handlers.get(FETCH_QUEUE)?.([job(FETCH_QUEUE, fetchSent?.data, "job-2")]);
    const scoreSent = sent[1];
    expect(scoreSent?.name).toBe(SCORE_QUEUE);

    await handlers.get(SCORE_QUEUE)?.([job(SCORE_QUEUE, scoreSent?.data as ScoreJobData, "job-3")]);
    const selectSent = sent[2];
    expect(selectSent?.name).toBe(SELECT_QUEUE);

    await handlers.get(SELECT_QUEUE)?.([
      job(SELECT_QUEUE, selectSent?.data as SelectJobData, "job-4"),
    ]);
    const sendSent = sent[3];
    expect(sendSent?.name).toBe(SEND_QUEUE);

    await handlers.get(SEND_QUEUE)?.([job(SEND_QUEUE, sendSent?.data as SendJobData, "job-5")]);

    expect(steps.calls).toEqual(["discover", "fetch", "score", "select", "send"]);
    const runIds = sent.map((entry) => (entry.data as { runId: string }).runId);
    expect(new Set(runIds).size).toBe(1);
    expect(runIds[0]).toContain("run-1");
    const origins = sent.map((entry) => (entry.data as { originQueue: string }).originQueue);
    expect(origins).toEqual([FETCH_QUEUE, SCORE_QUEUE, SELECT_QUEUE, SEND_QUEUE]);
  });

  it("throws when the chained send is not queued so pg-boss retries", async () => {
    const { boss, handlers } = createFakeBoss(null);
    await registerWorker(boss, stubSteps(), silentLogger);

    await expect(
      handlers.get(DISCOVER_QUEUE)?.([
        job(DISCOVER_QUEUE, {
          originQueue: DISCOVER_QUEUE,
          runId: "run-1",
          triggeredAt: "2026-09-12T00:00:00.000Z",
        }),
      ]),
    ).rejects.toThrow("was not queued");
  });

  it("lets step failures propagate so pg-boss retries then dead-letters", async () => {
    const { boss, handlers } = createFakeBoss();
    const steps = stubSteps({
      fetch: async () => {
        throw new Error("provider exploded");
      },
    });
    await registerWorker(boss, steps, silentLogger);

    const payload = {
      candidates: [],
      originQueue: FETCH_QUEUE,
      runId: "run-1",
    } satisfies FetchJobData;
    await expect(handlers.get(FETCH_QUEUE)?.([job(FETCH_QUEUE, payload)])).rejects.toThrow(
      "provider exploded",
    );
  });
});
