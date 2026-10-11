import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./testing/browser", workers: 1, timeout: 180_000,
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR || "./test-results", reporter: "list",
  use: { baseURL: process.env.LIVE_REIMAGINE_URL || "http://127.0.0.1:5175", channel: process.env.PLAYWRIGHT_CHANNEL || "msedge", headless: true, actionTimeout: 15_000, navigationTimeout: 30_000, viewport: { width: 1440, height: 1000 }, screenshot: "only-on-failure", trace: "off" },
});
