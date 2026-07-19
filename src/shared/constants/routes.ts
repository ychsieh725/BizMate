/**
 * 應用路由與 API 端點常數。
 * 集中管理避免各處硬編碼字串（coding-style「無硬編碼值」）。
 * 多租戶重構後：報價精靈掛在商家專屬分享連結 /q/{slug} 下；
 * LINE 與 admin 端點已隨終審通路改為網頁後台而移除。
 */

/** 前端頁面路由 */
export const PAGE_ROUTES = {
  home: "/",
  /** 客戶端中性首頁——/q/{slug} 向導的「回首頁」導向這裡，而非商家行銷首頁 `home`
   *（客戶不該被導去看商家登入/註冊 CTA）。 */
  customerHome: "/thanks",
  quoteWizard: (slug: string) => `/q/${slug}`,
  login: "/login",
  signup: "/signup",
  onboarding: "/onboarding",
  dashboard: "/dashboard",
  dashboardQuotes: "/dashboard/quotes",
  dashboardQuote: (id: string) => `/dashboard/quotes/${id}`,
  dashboardServices: "/dashboard/services",
  dashboardSettings: "/dashboard/settings",
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
  dashboardQuoteConfirm: (id: string) => `/api/dashboard/quotes/${id}/confirm`,
  dashboardQuoteDecline: (id: string) => `/api/dashboard/quotes/${id}/decline`,
  dashboardQuoteSend: (id: string) => `/api/dashboard/quotes/${id}/send`,
  dashboardSettings: "/api/dashboard/settings",
} as const;
