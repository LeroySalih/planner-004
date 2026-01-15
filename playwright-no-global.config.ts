import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
    testDir: "./tests",
    fullyParallel: true,
    retries: 0,
    workers: 1,
    reporter: [["html", {
        outputFolder: "tests/results/no-global-report",
        open: "never",
    }]],
    use: {
        screenshot: "only-on-failure",
        baseURL: "http://localhost:3000",
        trace: "on-first-retry",
    },
    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
        },
    ],
});
