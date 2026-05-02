import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { validateBenchmarkGateReady } from "../packages/domain/src/benchmark/recent-deals-benchmark-validation.js";

const benchmarkPath = resolve(process.cwd(), "tests/golden/recent-deals-benchmark.json");

const run = async (): Promise<void> => {
  const raw = JSON.parse(await readFile(benchmarkPath, "utf-8")) as unknown;
  const result = validateBenchmarkGateReady(raw);

  if (!result.ok) {
    process.stderr.write(`benchmark gate failed: ${benchmarkPath}\n`);
    for (const error of result.errors) {
      process.stderr.write(`- ${error}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`benchmark gate passed: ${benchmarkPath}\n`);
};

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`benchmark gate failed: ${message}\n`);
  process.exitCode = 1;
});
