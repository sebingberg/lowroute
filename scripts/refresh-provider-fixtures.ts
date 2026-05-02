import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const fixtureFiles = [
  "tests/contract/duffel.fixtures.json",
  "tests/contract/kiwi.fixtures.json",
  "tests/contract/travelpayouts.fixtures.json",
];

const travelpayoutsContractRecords = [
  {
    kind: "history_ok",
    payload: {
      success: true,
      origin: "EZE",
      destination: "MAD",
      data: {
        "2026-09-01": { price: 500 },
        "2026-09-08": { price: 300 },
        "2026-09-15": { price: 400 },
        "2026-09-22": { price: 200 },
        "2026-09-29": { price: 100 },
      },
    },
  },
  {
    kind: "trend_ok",
    payload: {
      success: true,
      data: [
        { origin: "MIA", destination: "BOG", value: 180 },
        { origin: "MIA", destination: "BOG", value: 220 },
        { origin: "MIA", destination: "BOG", value: 200 },
      ],
    },
  },
] as const;

const run = async (): Promise<void> => {
  const refreshedAt = new Date().toISOString();

  await Promise.all(
    fixtureFiles.map(async (relativePath) => {
      const absolutePath = resolve(process.cwd(), relativePath);
      const travelpayouts = relativePath.endsWith("travelpayouts.fixtures.json");
      const payload = {
        refreshed_at_utc: refreshedAt,
        note: travelpayouts
          ? "Offline provider-envelope samples for Travelpayouts baseline parsers (see baseline-adapter.ts)."
          : "Scaffold placeholder fixture. Replace with live provider responses.",
        records: travelpayouts ? [...travelpayoutsContractRecords] : [],
      };

      await writeFile(absolutePath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
    }),
  );

  await execFileAsync("pnpm", ["exec", "biome", "format", "--write", ...fixtureFiles]);
};

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`refresh fixtures failed: ${message}\n`);
  process.exitCode = 1;
});
