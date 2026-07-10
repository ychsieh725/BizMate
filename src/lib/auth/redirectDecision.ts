const PROTECTED_PREFIXES = ["/dashboard", "/onboarding"];
const AUTH_PAGE_PREFIXES = ["/login", "/signup"];
const ONBOARDING_PREFIX = "/onboarding";

/**
 * middleware 的重導決策，抽成純函式以便脫離 Supabase/NextRequest 獨立測試。
 * hasMerchant 預設 true：未登入時該值不影響判斷（第一條規則已短路），
 * 呼叫端只在「已登入」情境才需要傳入真實查詢結果。
 */
export function decideRedirect(
  pathname: string,
  isAuthenticated: boolean,
  hasMerchant: boolean = true,
): string | null {
  const isProtected = PROTECTED_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix),
  );
  const isAuthPage = AUTH_PAGE_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix),
  );
  const isOnboardingPage = pathname.startsWith(ONBOARDING_PREFIX);

  if (!isAuthenticated && isProtected) {
    return "/login";
  }

  if (isAuthenticated && !hasMerchant && isProtected && !isOnboardingPage) {
    return "/onboarding";
  }

  if (isAuthenticated && hasMerchant && isOnboardingPage) {
    return "/dashboard";
  }

  if (isAuthenticated && isAuthPage) {
    return hasMerchant ? "/dashboard" : "/onboarding";
  }

  return null;
}
