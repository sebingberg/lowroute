import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@lowroute/config": fileURLToPath(new URL("../config/src/index.ts", import.meta.url)),
    },
  },
});
