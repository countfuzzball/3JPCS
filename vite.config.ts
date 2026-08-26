import { defineConfig } from "vitest/config";

export default defineConfig({
  // Keep production asset URLs relative so the static build also works when it is
  // hosted below a path such as /polygon-county/ instead of at the domain root.
  base: "./",
  build: {
    target: "es2022",
    sourcemap: true,
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
