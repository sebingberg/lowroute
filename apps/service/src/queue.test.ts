import { describe, expect, it, vi } from "vitest";

import { Money, toOfferDto } from "@lowroute/domain";

import {
  CHAIN_QUEUES,
  type ChainSteps,
  DEAD_LETTER_QUEUE,
  DEFAULT_DISCOVERY_INTERVAL_MIN,
  DISCOVER_QUEUE,
  discoveryCron,
  fetchCandidateOffers,
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

  it("rehydrates offer DTOs to Money before scoring and enqueues JSON-safe data", async () => {
    const { boss, handlers, sent } = createFakeBoss();
    const seenByScore: { quotedMinorUnits: unknown; isMoney: boolean }[] = [];
    const steps = stubSteps({
      score: (offers) => {
        for (const offer of offers) {
          seenByScore.push({
            isMoney: offer.quoted_price instanceof Money,
            quotedMinorUnits: offer.quoted_price.minorUnits,
          });
        }
        return offers;
      },
    });
    await registerWorker(boss, steps, silentLogger);

    const dto = toOfferDto({
      airport_change: false,
      cabin: "economy",
      carry_on_included: true,
      checked_bag_included: false,
      connection_minutes_min: 60,
      departure_date: "2026-10-01",
      destination: "MAD",
      destination_tier: "medium",
      max_layover_hours: 8,
      merchant_country: "US",
      normalized_payable: Money.fromDecimal(500, "USD"),
      origin: "EZE",
      overnight_layover: false,
      payment_path: "merchant_outside_ar",
      provider: "duffel",
      quoted_price: Money.fromDecimal(500, "USD"),
      return_date: "2026-10-15",
      score: 0,
      self_transfer: false,
      separate_tickets: false,
      trip_days: 14,
    });
    const payload = {
      offers: [dto],
      originQueue: SCORE_QUEUE,
      runId: "run-1",
    } satisfies ScoreJobData;
    await handlers.get(SCORE_QUEUE)?.([job(SCORE_QUEUE, payload, "job-3")]);

    expect(seenByScore).toEqual([{ isMoney: true, quotedMinorUnits: 50000n }]);
    expect(sent).toHaveLength(1);
    expect(() => JSON.stringify(sent[0]?.data)).not.toThrow();
  });
});

describe("fetchCandidateOffers", () => {
  const search = {
    origin: "EZE",
    destination: "MAD",
    departure_date: "2026-10-01",
    return_date: "2026-10-15",
    cabin: "economy" as const,
    adults: 1 as const,
    max_layover_hours: 8,
  };
  it("fans out one candidate per search request through the provider adapter path", async () => {
    const offerFor = (provider: "duffel" | "kiwi" | "travelpayouts", id: string) => ({
      provider,
      id,
      origin: "EZE",
      destination: "MAD",
      departure_date: "2026-10-01",
      return_date: "2026-10-15",
      merchant_country: "US",
      currency: "USD",
      quoted_amount: 500,
      risk: {
        self_transfer: false,
        separate_tickets: false,
        airport_change: false,
        overnight_layover: false,
        checked_bag_included: false,
        carry_on_included: true,
        connection_minutes_min: 60,
      },
      raw_ref: `${provider}:${id}`,
    });
    const stubProbe = (provider: "duffel" | "kiwi" | "travelpayouts", ids: string[]) => ({
      run: vi.fn(async () => ({
        provider,
        searched_at_utc: "2026-09-12T00:00:00.000Z",
        request: search,
        offers: ids.map((id) => offerFor(provider, id)),
      })),
    });
    const probes = {
      duffel: stubProbe("duffel", ["d1"]),
      kiwi: stubProbe("kiwi", []),
      travelpayouts: stubProbe("travelpayouts", []),
    };
    const candidates = [
      {
        origin: "EZE",
        destination: "MAD",
        departure_date: "2026-10-01",
        min_trip_days: 7,
        max_trip_days: 14,
      },
      {
        origin: "EZE",
        destination: "MAD",
        departure_date: "2026-11-01",
        min_trip_days: 7,
        max_trip_days: 14,
      },
    ];

    const offers = await fetchCandidateOffers(candidates, {
      probes,
      env: { DUFFEL_API_KEY: "duffel-key", KIWI_API_KEY: "kiwi-key", TRAVELPAYOUTS_TOKEN: "tp" },
    });

    expect(offers).toHaveLength(2);
    expect(offers[0]?.quoted_price).toBeInstanceOf(Money);
    expect(offers[0]?.trip_days).toBe(14);
    expect(probes.duffel.run).toHaveBeenCalledTimes(2);
    expect(probes.duffel.run).toHaveBeenCalledWith(
      expect.objectContaining({ origin: "EZE", destination: "MAD", departure_date: "2026-10-01" }),
      expect.objectContaining({ apiKey: "duffel-key" }),
    );
  });
});
