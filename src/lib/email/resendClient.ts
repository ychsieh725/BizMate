import { Resend } from "resend";
import { requireEnv } from "@/lib/env.ts";

/**
 * Resend client 單例（比照 getGeminiClient，用 requireEnv 延遲要求 API key——
 * RESEND_API_KEY 在 env.ts 中是 optional，缺少時在此明確報錯）。
 * ⚠️ 僅供伺服器端使用：RESEND_API_KEY 為機密，不進客戶端 bundle。
 */
let cachedClient: Resend | null = null;

function getResendClient(): Resend {
  if (cachedClient) {
    return cachedClient;
  }
  cachedClient = new Resend(requireEnv("RESEND_API_KEY"));
  return cachedClient;
}

export type SendEmailParams = {
  to: string;
  replyTo: string;
  subject: string;
  html: string;
  text: string;
};

export type SendEmailResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

/** 寄送一封 Email；失敗回傳明確錯誤訊息，呼叫端自行決定要不要重試。 */
export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const { data, error } = await getResendClient().emails.send({
    from: requireEnv("EMAIL_FROM"),
    to: params.to,
    replyTo: params.replyTo,
    subject: params.subject,
    html: params.html,
    text: params.text,
  });
  if (error) {
    return { ok: false, message: error.message };
  }
  if (!data) {
    return { ok: false, message: "Resend 未回傳寄送結果" };
  }
  return { ok: true };
}
