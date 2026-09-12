import { describe, expect, it } from "vitest";

import {
  parseReplayArgs,
  REPLAY_DEFAULT_LIMIT,
  type ReplayArgs,
  type ReplayBoss,
  replayDeadLetters,
} from "./dead-letter.js";
import { DEAD_LETTER_QUEUE, FETCH_QUEUE, SCORE_QUEUE } from "./queue.js";

const createFakeBoss = (
  jobs: { data: Record<string, unknown>; id: string }[],
  sendResult: string | null = "replay-job-id",
) => {
  const completed: { id: string; queue: string }[] = [];
  const fetched: { options: { batchSize?: number }; queue: string }[] = [];
  const sent: { data: Record<string, unknown>; name: string }[] = [];
  let size = jobs.length;
  const boss: ReplayBoss = {
    complete: async (queue, id) => {
      completed.push({ id, queue });
    },
    fetch: async <T>(queue: string, options: { batchSize?: number }) => {
      fetched.push({ options, queue });
      return jobs as { data: T; id: string }[];
    },
    getQueue: async () => ({ queuedCount: size }),
    send: async (name, data) => {
      sent.push({ data, name });
      return sendResult;
    },
  };
  return {
    boss,
    completed,
    fetched,
    sent,
    setSize: (next: number) => {
      size = next;
    },
  };
};

describe("parseReplayArgs", () => {
  it("parses queue, limit, and dry-run", () => {
    expect(parseReplayArgs(["--queue", FETCH_QUEUE, "--limit", "10", "--dry-run"])).toEqual({
      dryRun: true,
      limit: 10,
      originQueue: FETCH_QUEUE,
    });
  });

  it("defaults limit and dry-run", () => {
    expect(parseReplayArgs(["--queue", FETCH_QUEUE])).toEqual({
      dryRun: false,
      limit: REPLAY_DEFAULT_LIMIT,
      originQueue: FETCH_QUEUE,
    });
  });

  it("rejects missing, unknown, or flag-eaten queues", () => {
    expect(() => parseReplayArgs([])).toThrow("--queue");
    expect(() => parseReplayArgs(["--queue", "nope"])).toThrow("--queue");
    expect(() => parseReplayArgs(["--queue", "--dry-run"])).toThrow("--queue");
  });

  it("rejects bad limits", () => {
    const base = ["--queue", FETCH_QUEUE, "--limit"];
    expect(() => parseReplayArgs([...base, "0"])).toThrow("--limit");
    expect(() => parseReplayArgs([...base, "-3"])).toThrow("--limit");
    expect(() => parseReplayArgs([...base, "many"])).toThrow("--limit");
  });
});

describe("replayDeadLetters", () => {
  it("dry-run reports size without fetching", async () => {
    const { boss, fetched, sent } = createFakeBoss([{ data: {}, id: "dlq-1" }]);
    const lines: string[] = [];

    const result = await replayDeadLetters(
      boss,
      { dryRun: true, limit: 50, originQueue: FETCH_QUEUE } satisfies ReplayArgs,
      (line) => {
        lines.push(line);
      },
    );

    expect(result).toEqual({ inspected: 1, replayed: 0 });
    expect(fetched).toEqual([]);
    expect(sent).toEqual([]);
    expect(lines).toEqual([`would replay 1 job(s) from ${DEAD_LETTER_QUEUE} to ${FETCH_QUEUE}`]);
  });

  it("replays fetched jobs then completes them", async () => {
    const jobs = [
      { data: { originQueue: FETCH_QUEUE, runId: "run-1" }, id: "dlq-1" },
      { data: { originQueue: FETCH_QUEUE, runId: "run-2" }, id: "dlq-2" },
    ];
    const { boss, completed, sent } = createFakeBoss(jobs);
    const lines: string[] = [];

    const result = await replayDeadLetters(
      boss,
      { dryRun: false, limit: 50, originQueue: FETCH_QUEUE } satisfies ReplayArgs,
      (line) => {
        lines.push(line);
      },
    );

    expect(result).toEqual({ inspected: 2, replayed: 2 });
    expect(sent.map((entry) => entry.name)).toEqual([FETCH_QUEUE, FETCH_QUEUE]);
    expect(sent[0]?.data).toEqual({ originQueue: FETCH_QUEUE, runId: "run-1" });
    expect(completed).toEqual([
      { id: "dlq-1", queue: DEAD_LETTER_QUEUE },
      { id: "dlq-2", queue: DEAD_LETTER_QUEUE },
    ]);
    expect(lines).toHaveLength(3);
  });

  it("refuses mixed origins without side effects", async () => {
    const jobs = [
      { data: { originQueue: FETCH_QUEUE, runId: "run-1" }, id: "dlq-1" },
      { data: { originQueue: SCORE_QUEUE, runId: "run-2" }, id: "dlq-2" },
    ];
    const { boss, completed, sent } = createFakeBoss(jobs);
    const args: ReplayArgs = { dryRun: false, limit: 50, originQueue: FETCH_QUEUE };

    await expect(replayDeadLetters(boss, args, () => undefined)).rejects.toThrow("other origins");
    expect(sent).toEqual([]);
    expect(completed).toEqual([]);
  });

  it("refuses jobs without an origin", async () => {
    const { boss, completed, sent } = createFakeBoss([{ data: { runId: "run-1" }, id: "dlq-1" }]);
    const args: ReplayArgs = { dryRun: false, limit: 50, originQueue: FETCH_QUEUE };

    await expect(replayDeadLetters(boss, args, () => undefined)).rejects.toThrow("unknown");
    expect(sent).toEqual([]);
    expect(completed).toEqual([]);
  });

  it("does not complete when the replay send is not queued", async () => {
    const jobs = [{ data: { originQueue: FETCH_QUEUE, runId: "run-1" }, id: "dlq-1" }];
    const { boss, completed } = createFakeBoss(jobs, null);
    const args: ReplayArgs = { dryRun: false, limit: 50, originQueue: FETCH_QUEUE };

    await expect(replayDeadLetters(boss, args, () => undefined)).rejects.toThrow("was not queued");
    expect(completed).toEqual([]);
  });
});
