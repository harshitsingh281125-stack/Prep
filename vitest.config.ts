import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Vitest config — unit tests for pure logic (the seed generator). No browser, no
// DB. Playwright handles anything that needs a real session/DB (see playwright/).
// The `@/…` alias mirrors tsconfig so tests import the same way app code does.
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
});
