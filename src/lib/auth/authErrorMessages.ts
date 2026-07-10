const KNOWN_MESSAGES: Record<string, string> = {
  "Invalid login credentials": "帳號或密碼錯誤",
  "User already registered": "此 Email 已被註冊",
  "Password should be at least 6 characters": "密碼至少需要 6 個字元",
  "Email not confirmed": "請先完成信箱驗證",
};

/**
 * Supabase Auth 原始錯誤訊息一律英文且可能含內部細節；
 * 對應到白名單中文訊息，未知訊息一律 fallback，不外洩原始內容給使用者。
 */
export function toFriendlyAuthError(message: string): string {
  return KNOWN_MESSAGES[message] ?? "發生未預期的錯誤，請稍後再試";
}
