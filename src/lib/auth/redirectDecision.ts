const PROTECTED_PREFIXES = ["/dashboard", "/onboarding"];
const AUTH_PAGE_PREFIXES = ["/login", "/signup"];
const ONBOARDING_PREFIX = "/onboarding";
const MERCHANT_LOOKUP_PREFIXES = [...AUTH_PAGE_PREFIXES, ONBOARDING_PREFIX];

/**
 * middleware 是否需要查 merchants 表才能做重導決策。
 * 只有 /onboarding（有 merchant 者導回 /dashboard）與 /login、/signup
 * （登入者依有無 merchant 決定去向）需要真實查詢；/dashboard 路徑不查——
 * 「無 merchant」的守門交給 layout（requireMerchant 403 → redirect /onboarding），
 * 讓最高頻的後台導覽省下每次一趟 DB 往返。
 */
export function needsMerchantLookup(pathname: string): boolean {
  return MERCHANT_LOOKUP_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

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
