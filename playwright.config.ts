import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * BizMate E2E 設定（WBS 8.2）。
 *
 * 對「真實」本機 dev stack 執行：真實 Supabase dev 專案、真實 Gemini、真實 Resend
 * ——與 scripts/verify-*.ts「integration 邊界不 mock」的慣例一致。
 *
 * webServer 會自動啟動 `pnpm dev` 並等待 http://localhost:3000，
 * 故 `pnpm test:e2e` 即可自帶啟動、無需先手動開 server。
 *
 * 只跑 chromium 單一 project、workers=1、retries=0：
 * - /api/sessions 有雙桶限流（10 次/小時），跨瀏覽器重複跑會燒額度。
 * - 寄信步驟會真的呼叫 Resend（免費額度 100 封/日），retry 會重寄，故不自動重試。
 * WebKit 已在此環境驗證可用；要跨瀏覽器時再另加 project，勿與金流/寄信路徑同跑。
 */

// 測試 worker 需要 SUPABASE_* 等機密建立 service_role admin client。
// Next dev（webServer）會自載 .env.local，但測試 worker 是獨立行程，需自行載入。
try {
  process.loadEnvFile(path.resolve(process.cwd(), ".env.local"));
} catch {
  // 已由外層 shell / tsx --env-file 載入時忽略。
}

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: BASE_URL,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    stderr: "pipe",
  },
});
