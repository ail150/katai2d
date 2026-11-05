import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

const root = resolve(import.meta.dirname, '../..')
const isWin = process.platform === 'win32'
const testData = process.env.KATAI_TEST_DATA_DIR || (isWin ? '/tmp/katai-web-playwright-data' : resolve(tmpdir(), 'katai-web-playwright-data'))
const token = 'katai-playwright-owner-token'
const cli = process.env.KATAI_CLI || (isWin ? '/mnt/c/Users/THIN 15 RYZEN/Documents/FEM/katai2d/build/ubuntu-24.04/bin/katai' : resolve(root, 'build/ubuntu-24.04/bin/katai'))
const uvicornCmd = isWin
  ? `wsl bash -c "cd /mnt/c/Users/THIN\\\\ 15\\\\ RYZEN/Documents/FEM/katai2d/web/server && KATAI_ACCESS_TOKEN='${token}' KATAI_CLI='${cli}' KATAI_DATA_DIR='${testData}' .venv/bin/uvicorn app:app --host 127.0.0.1 --port 8000 --workers 1"`
  : 'python3 -m uvicorn app:app --host 127.0.0.1 --port 8000 --workers 1'

export default defineConfig({
  testDir: './e2e',
  timeout: 600_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173',
    viewport: { width: 1600, height: 1000 },
    launchOptions: process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: process.env.PLAYWRIGHT_SKIP_SERVER ? undefined : [
    {
      command: uvicornCmd,
      cwd: resolve(root, 'web/server'),
      port: 8000,
      timeout: 30_000,
      reuseExistingServer: !process.env.CI,
      env: { ...process.env, KATAI_ACCESS_TOKEN: token, KATAI_CLI: cli, KATAI_DATA_DIR: testData },
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 5173',
      cwd: import.meta.dirname,
      port: 5173,
      timeout: 30_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
})
