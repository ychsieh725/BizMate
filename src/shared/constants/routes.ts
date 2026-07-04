/**
 * 應用路由與 API 端點常數（SDS §5）。
 * 集中管理避免各處硬編碼字串（coding-style「無硬編碼值」）。
 */

/** 前端頁面路由 */
export const PAGE_ROUTES = {
  home: "/",
  wizard: "/wizard",
  adminEval: "/admin/eval",
  adminCost: "/admin/cost",
} as const;

/** API 端點（SDS §5.1 客戶端 / §5.2 LINE / §5.3 Admin） */
export const API_ROUTES = {
  sessions: "/api/sessions",
  session: (id: string) => `/api/sessions/${id}`,
  describe: (id: string) => `/api/sessions/${id}/describe`,
  answer: (id: string) => `/api/sessions/${id}/answer`,
  status: (id: string) => `/api/sessions/${id}/status`,
  lineWebhook: "/api/line/webhook",
  adminEval: "/api/admin/eval",
  adminCost: "/api/admin/cost",
  adminEvalRun: "/api/admin/eval/run",
} as const;
