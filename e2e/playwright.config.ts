import { defineConfig } from "@playwright/test";

// The suite runs against a live stack (docker-compose.test.yml locally or
// in CI, or a deployed URL via E2E_BASE_URL). Chromium gets a fake camera/
// microphone so the ceremony's photo step works headlessly; the fake feed
// stands in for the signer's front camera.
export default defineConfig({
  testDir: "./tests",
  globalSetup: "./global-setup.ts",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  outputDir: "test-results",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    launchOptions: {
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
      ],
    },
  },
  projects: [{ name: "chromium" }],
});
