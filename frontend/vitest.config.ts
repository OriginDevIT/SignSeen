import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
  // Match the Next.js build: JSX uses the automatic runtime, so
  // component files under test don't need React in scope.
  esbuild: {
    jsx: "automatic",
  },
});
