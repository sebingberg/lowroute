import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@lowroute/config": fileURLToPath(
        new URL("../../packages/config/src/index.ts", import.meta.url),
      ),
      "@lowroute/domain": fileURLToPath(
        new URL("../../packages/domain/src/index.ts", import.meta.url),
      ),
      "@lowroute/notifications": fileURLToPath(
        new URL("../../packages/notifications/src/index.ts", import.meta.url),
      ),
      "@lowroute/persistence": fileURLToPath(
        new URL("../../packages/persistence/src/index.ts", import.meta.url),
      ),
      "@lowroute/providers": fileURLToPath(
        new URL("../../packages/providers/src/index.ts", import.meta.url),
      ),
    },
  },
});
