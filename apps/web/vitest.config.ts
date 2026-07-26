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
      thresholds: {
        lines: 80,
        branches: 75,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
