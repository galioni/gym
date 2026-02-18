import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: [
      "application/**/*.test.ts",
      "application/**/*.test.tsx",
      "infrastructure/**/*.test.ts",
      "infrastructure/**/*.test.tsx",
      "features/**/*.test.ts",
      "features/**/*.test.tsx",
      "components/**/*.test.ts",
      "components/**/*.test.tsx",
    ],
  },
});
