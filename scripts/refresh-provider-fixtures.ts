import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const fixtureFiles = [
  "tests/contract/duffel.fixtures.json",
  "tests/contract/kiwi.fixtures.json",
  "tests/contract/travelpayouts.fixtures.json",
];

const run = async (): Promise<void> => {
  const refreshedAt = new Date().toISOString();

  await Promise.all(
    fixtureFiles.map(async (relativePath) => {
      const absolutePath = resolve(process.cwd(), relativePath);
      const payload = {
        refreshed_at_utc: refreshedAt,
        note: "Scaffold placeholder fixture. Replace with live provider responses.",
        records: [],
      };

      await writeFile(absolutePath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
    }),
  );
};

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`refresh fixtures failed: ${message}\n`);
  process.exitCode = 1;
});
