import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Pure helpers only (lib/**). `@` mirrors the tsconfig path alias (the dashboard root), so tests
// import modules the same way the app does.
export default defineConfig({
  resolve: {
    alias: { "@": dirname(fileURLToPath(import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
