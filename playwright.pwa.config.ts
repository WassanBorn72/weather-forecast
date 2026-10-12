import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests/e2e', testMatch: 'pwa.spec.ts', timeout: 45_000, use: { baseURL: 'http://127.0.0.1:4173', launchOptions: { executablePath: process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), args: ['--no-sandbox'] }, viewport: { width: 390, height: 844 } }, webServer: { command: 'npm run preview -- --port 4173', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI }, reporter: 'list' });
