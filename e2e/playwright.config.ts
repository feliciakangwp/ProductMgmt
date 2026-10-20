import { defineConfig, devices } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * End-to-end tests run the real web app and API against the local stack from
 * e2e/stack/start.sh (PostgreSQL + GoTrue + PostgREST) and a mock Anthropic
 * endpoint. Start the stack first:  bash e2e/stack/start.sh
 */
const stackEnvPath = fileURLToPath(new URL('./.stack/env', import.meta.url));
const stack: Record<string, string> = {};
try {
  for (const line of readFileSync(stackEnvPath, 'utf8').split('\n')) {
    const [k, ...v] = line.split('=');
    if (k && v.length) stack[k] = v.join('=');
  }
} catch {
  throw new Error('Local stack not running. Start it with: bash e2e/stack/start.sh');
}

const WEB_PORT = 5174;
const API_PORT = 8788;
const MOCK_PORT = 4010;

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1600, height: 1000 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1600, height: 1000 },
        launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
      },
    },
  ],
  webServer: [
    {
      command: 'npx tsx stack/mock-anthropic.ts',
      port: MOCK_PORT,
      env: { MOCK_ANTHROPIC_PORT: String(MOCK_PORT) },
      reuseExistingServer: false,
    },
    {
      command: 'npm run start --workspace @productflow/api',
      cwd: '..',
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      env: {
        PORT: String(API_PORT),
        CORS_ORIGIN: `http://localhost:${WEB_PORT}`,
        SUPABASE_URL: stack.SUPABASE_URL!,
        SUPABASE_ANON_KEY: stack.SUPABASE_ANON_KEY!,
        ANTHROPIC_API_KEY: 'test-key',
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
      },
      reuseExistingServer: false,
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      cwd: '../apps/web',
      port: WEB_PORT,
      env: {
        VITE_SUPABASE_URL: stack.SUPABASE_URL!,
        VITE_SUPABASE_ANON_KEY: stack.SUPABASE_ANON_KEY!,
        VITE_API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}`,
      },
      reuseExistingServer: false,
    },
  ],
});
