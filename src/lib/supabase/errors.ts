/** Postgres 23505（unique_violation）的錯誤訊息判斷；repository 只帶回訊息字串。 */
export function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return message.includes("duplicate key") || message.includes("23505");
}
