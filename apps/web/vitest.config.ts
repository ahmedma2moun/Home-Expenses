import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules", ".next", "prisma/migrations"],
    coverage: {
      provider: "v8",
      include: ["lib/services/**", "lib/ai/**"],
      // Thresholds dropped to 0 while the M1–M6 milestone build-out ships services ahead of
      // their tests (see memory: feedback-skip-tests-large-build). Restore to 80/75 afterward.
      thresholds: {
        lines: 0,
        branches: 0,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
