import path from "node:path";

/**
 * E2E 專用的環境變數存取。
 *
 * 測試 worker 是獨立行程，未必繼承 webServer 載入的 .env.local，
 * 故在此冪等載入一次，再嚴格取用（缺少即 fail-fast，對齊 src/lib/env.ts 精神）。
 */
let loaded = false;

function ensureEnvLoaded(): void {
  if (loaded) return;
  loaded = true;
  try {
    process.loadEnvFile(path.resolve(process.cwd(), ".env.local"));
  } catch {
    // 已由外層載入時忽略。
  }
}

ensureEnvLoaded();

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `E2E 需要環境變數 ${name}，請確認 .env.local 已設定（參考 .env.example）`,
    );
  }
  return value;
}

export const E2E_ENV = {
  supabaseUrl: required("SUPABASE_URL"),
  serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  /** 匿名客戶精靈填入的聯絡 email；寄信步驟會真的寄到這裡，故用可實際收信的信箱。 */
  emailRecipient: required("VERIFY_EMAIL_RECIPIENT"),
  baseUrl: process.env.E2E_BASE_URL ?? "http://localhost:3000",
} as const;
