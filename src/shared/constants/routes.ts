/**
 * 應用路由與 API 端點常數。
 * 集中管理避免各處硬編碼字串（coding-style「無硬編碼值」）。
 * 多租戶重構後：報價精靈掛在商家專屬分享連結 /q/{slug} 下；
 * LINE 與 admin 端點已隨終審通路改為網頁後台而移除。
 */

/** 前端頁面路由 */
export const PAGE_ROUTES = {
  home: "/",
  quoteWizard: (slug: string) => `/q/${slug}`,
  login: "/login",
  signup: "/signup",
  onboarding: "/onboarding",
  dashboard: "/dashboard",
  dashboardQuotes: "/dashboard/quotes",
  dashboardQuote: (id: string) => `/dashboard/quotes/${id}`,
} as const;

/** API 端點 */
export const API_ROUTES = {
  sessions: "/api/sessions",
  session: (id: string) => `/api/sessions/${id}`,
  describe: (id: string) => `/api/sessions/${id}/describe`,
  answer: (id: string) => `/api/sessions/${id}/answer`,
  status: (id: string) => `/api/sessions/${id}/status`,
  dashboardQuotes: "/api/dashboard/quotes",
  dashboardQuote: (id: string) => `/api/dashboard/quotes/${id}`,
} as const;
