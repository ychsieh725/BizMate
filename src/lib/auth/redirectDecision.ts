const PROTECTED_PREFIXES = ["/dashboard", "/onboarding"];
const AUTH_PAGE_PREFIXES = ["/login", "/signup"];

/**
 * middleware 的重導決策，抽成純函式以便脫離 Supabase/NextRequest 獨立測試。
 */
export function decideRedirect(
  pathname: string,
  isAuthenticated: boolean,
): string | null {
  const isProtected = PROTECTED_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix),
  );
  const isAuthPage = AUTH_PAGE_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix),
  );

  if (!isAuthenticated && isProtected) {
    return "/login";
  }

  if (isAuthenticated && isAuthPage) {
    return "/dashboard";
  }

  return null;
}
