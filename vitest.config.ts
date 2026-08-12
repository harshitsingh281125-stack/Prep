import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Vitest config — unit tests for pure logic (seed generator, recall scheduler,
// progress aggregation, AI gateway). No browser, no DB. Playwright handles
// anything that needs a real session/DB (see tests/e2e/).
// The `@/…` alias mirrors tsconfig so tests import the same way app code does.
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      // `server-only` throws on import outside a React Server Component, which is
      // exactly its job — it's what makes leaking the service-role key into a
      // client bundle a build error (lib/supabase/admin.ts). Vitest is neither a
      // server nor a client bundle, so it gets the same no-op module Next hands
      // to the server graph. Aliasing it here does NOT weaken the guard in the
      // app build; it only stops the guard from failing the test runner.
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
});
