import { defineConfig } from '@playwright/test';

// e2e: собранный редактор (vite preview). Браузер — Chromium из Playwright.
export default defineConfig({
    testDir: 'e2e',
    timeout: 120_000,
    fullyParallel: false,
    workers: 1,
    reporter: [['list']],
    use: {
        baseURL: 'http://localhost:4173/',
        viewport: { width: 1600, height: 950 },
        launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
    },
    webServer: {
        command: 'npm run build && npx vite preview --port 4173 --strictPort',
        url: 'http://localhost:4173/',
        reuseExistingServer: true,
        timeout: 180_000,
    },
});
