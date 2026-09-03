import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // Only pure functions are tested (chunker, citation parser), so no DOM env.
    environment: "node",
    include: ["src/**/*.test.ts"],
    // The chunker and citation parser are tested from Phase 4 onward; until then
    // `pnpm test` should still be a green command.
    passWithNoTests: true,
  },
});
