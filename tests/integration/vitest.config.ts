import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  // ! Keep root pinned to this directory so `vitest run --config ...`
  // ! from the repo root collects only integration tests.
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: {
    alias: {
      "@lowroute/config": fileURLToPath(
        new URL("../../packages/config/src/index.ts", import.meta.url),
      ),
      "@lowroute/domain": fileURLToPath(
        new URL("../../packages/domain/src/index.ts", import.meta.url),
      ),
      "@lowroute/persistence": fileURLToPath(
        new URL("../../packages/persistence/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["**/*.test.ts"],
    testTimeout: 15_000,
  },
});
