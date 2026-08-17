import { z } from "zod";

/**
 * 環境變數驗證（SDS §15、security.md「啟動時驗證必要秘密存在」）。
 *
 * 僅供伺服器端使用：這些皆為機密，命名不含 NEXT_PUBLIC_ 前綴，
 * Next.js 不會打包進客戶端 bundle。
 *
 * 分階段策略（對應 MVP P0→P2）：
 * - 核心（現在就需要）：Supabase 兩項，缺少即在啟動時 fail-fast。
 * - 功能性（後續任務啟用）：設為 optional；在真正使用的程式點以
 *   requireEnv() 明確報錯，避免現階段開發被尚未用到的變數卡住。
 */
/**
 * 選填變數包裝：.env 檔的空白值會以空字串 "" 載入（而非 undefined），
 * 故先把 "" 視為未設定，再套用內層驗證。避免「留空的未來變數」誤觸驗證。
 */
function optional<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => (value === "" ? undefined : value), schema.optional());
}

const envSchema = z.object({
  // 核心
  SUPABASE_URL: z.string().url("必須是合法的 URL"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "不可為空"),
  // 核心（5.2 起）：@supabase/ssr 用，client 端可見（anon key 本就設計為可公開）
  NEXT_PUBLIC_SUPABASE_URL: z.string().url("必須是合法的 URL"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, "不可為空"),
  // 功能性（啟用時由 requireEnv 把關；現階段留空不報錯）
  GEMINI_API_KEY: optional(z.string().min(1)),
  RESEND_API_KEY: optional(z.string().min(1)),
  EMAIL_FROM: optional(z.string().min(1)),
  // 本機 dev 商家的密碼。只有 seed / verify 腳本會用到，正式流程不需要，
  // 故為 optional——但它是真實 auth 帳號的密碼，絕不可寫死在原始碼裡。
  DEV_MERCHANT_PASSWORD: optional(z.string().min(12, "至少 12 字元")),
  // 功能性（A0 起）：agent-service（Python）的位址與雙向內部認證金鑰。
  // 兩者未設定時 callAgentService 回 not_configured，orchestrator 走 fallback
  // 到 resolveAfterParse——故此處維持 optional，缺漏不應讓整個 app 起不來。
  AGENT_SERVICE_URL: optional(z.string().url("必須是合法的 URL")),
  // 長度下限與 Python 端的 MIN_SECRET_LENGTH 一致，避免兩端規則漂移
  INTERNAL_SERVICE_SECRET: optional(z.string().min(16, "至少 16 字元")),
  // Feature flag（A4 起）：是否啟用 tool-calling agent。
  // **預設關閉**——需明確設為 "true" 才生效。A6 的指標對照通過前不開，
  // 且未設定時系統行為與 agent 化之前完全一致。
  AGENT_LOOP_ENABLED: optional(z.string()),
});

type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `環境變數驗證失敗：\n${issues}\n請檢查 .env.local（可參考 .env.example）`,
    );
  }
  return parsed.data;
}

export const env: Env = loadEnv();

/**
 * 取用「宣告為 optional 但當前功能實際需要」的環境變數。
 * 缺少時拋出明確錯誤，指出是哪個變數、該去哪補。
 */
export function requireEnv<K extends keyof Env>(key: K): NonNullable<Env[K]> {
  const value = env[key];
  if (value == null || value === "") {
    throw new Error(
      `環境變數 ${String(key)} 未設定，但目前功能需要它。請於 .env.local 補上。`,
    );
  }
  return value as NonNullable<Env[K]>;
}
