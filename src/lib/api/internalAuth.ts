import { timingSafeEqual } from "node:crypto";

/**
 * 內部服務端點（`/api/internal/**`）的認證。
 *
 * 這些端點只給 agent-service 呼叫，但**共用 domain 不代表它們受保護**——
 * 外部仍可直接請求（設計文件〈安全考量〉v3）。shared secret 是唯一防線。
 *
 * 與 Python 端 app/api/auth.py 對稱：同一個 header、同一個常數時間比對策略。
 */

const INTERNAL_SECRET_HEADER = "x-internal-secret";

/**
 * 常數時間比對兩個字串。
 *
 * 用 timingSafeEqual 而非 ===：後者在第一個相異字元就返回，會洩漏「猜對了
 * 幾個字元」的時間差。這裡的輸入來自網路，值得用常數時間比對。
 *
 * timingSafeEqual 要求兩個 buffer 等長，否則拋 RangeError；長度本身不是機密
 * （secret 長度不隨猜測改變），故先比長度再比內容是安全的。
 */
function secretsMatch(provided: string, expected: string): boolean {
  const providedBytes = Buffer.from(provided, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  if (providedBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(providedBytes, expectedBytes);
}

/**
 * 驗證請求是否帶有正確的內部服務金鑰。
 *
 * **fail closed**：未設定 INTERNAL_SERVICE_SECRET 時一律拒絕。設定漏了就等於
 * 沒有防線，此時放行比擋掉危險得多——寧可讓 agent 走 fallback，也不要讓端點裸奔。
 */
export function isInternalRequestAuthorized(request: Request): boolean {
  const expected = process.env.INTERNAL_SERVICE_SECRET;
  if (!expected) return false;

  const provided = request.headers.get(INTERNAL_SECRET_HEADER);
  if (!provided) return false;

  return secretsMatch(provided, expected);
}
