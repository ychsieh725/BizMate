import type { ApiResponse } from "@/shared/types/domain.types";
import { API_ROUTES } from "@/shared/constants/routes.ts";
import type {
  ApiResult,
  CreatedSession,
  DescribeOutcome,
  SelectedCategory,
} from "./wizardTypes.ts";

/**
 * Wizard 前端唯一的 fetch 出口（coding-style「在系統邊界驗證」+ DRY）。
 * 職責：呼叫端點 → 解 envelope → 網路/JSON/非 2xx 全部收斂成 ok:false，
 * 永不 throw，讓元件端只需處理 ok true/false 兩條路徑。
 */

/** describe 回傳的原始（snake_case）資料形狀。 */
type DescribeResponseData = {
  status: DescribeOutcome["status"];
  missing_fields?: readonly string[];
  quote_code?: string;
  out_of_scope?: boolean;
};

/** createSession 回傳的原始（snake_case）資料形狀。 */
type CreatedSessionData = {
  session_id: string;
  status: CreatedSession["status"];
};

/** 送 request 並解 envelope，回傳原始 data 或收斂後的錯誤。 */
async function request<TData>(
  url: string,
  init: RequestInit,
): Promise<ApiResult<TData>> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
  } catch {
    return { ok: false, error: "無法連線至伺服器，請檢查網路後再試", httpStatus: 0 };
  }

  let envelope: ApiResponse<TData> | null = null;
  try {
    envelope = (await response.json()) as ApiResponse<TData>;
  } catch {
    return { ok: false, error: "伺服器回應格式異常，請稍後再試", httpStatus: response.status };
  }

  if (!response.ok || !envelope.success || envelope.data === null) {
    return {
      ok: false,
      error: envelope.error ?? "系統忙碌，請稍後再試",
      httpStatus: response.status,
    };
  }

  return { ok: true, data: envelope.data };
}

/** Step 1：建立 session（slug 指向報價歸屬的商家，來自分享連結路徑）。 */
export async function createSession(
  category: SelectedCategory,
  slug: string,
): Promise<ApiResult<CreatedSession>> {
  const result = await request<CreatedSessionData>(API_ROUTES.sessions, {
    method: "POST",
    body: JSON.stringify({ category, slug }),
  });
  if (!result.ok) return result;
  return {
    ok: true,
    data: { sessionId: result.data.session_id, status: result.data.status },
  };
}

/** Step 2：送出口語描述與聯絡 email。 */
export async function submitDescribe(
  sessionId: string,
  input: { rawText: string; contactEmail: string },
): Promise<ApiResult<DescribeOutcome>> {
  const result = await request<DescribeResponseData>(
    API_ROUTES.describe(sessionId),
    {
      method: "POST",
      body: JSON.stringify({
        raw_text: input.rawText,
        contact_email: input.contactEmail,
      }),
    },
  );
  if (!result.ok) return result;

  const { status, missing_fields, quote_code, out_of_scope } = result.data;
  return {
    ok: true,
    data: {
      status,
      ...(missing_fields ? { missingFields: missing_fields } : {}),
      ...(quote_code ? { quoteCode: quote_code } : {}),
      ...(out_of_scope !== undefined ? { outOfScope: out_of_scope } : {}),
    },
  };
}

/** Step 4：輪詢目前狀態。 */
export async function fetchStatus(
  sessionId: string,
): Promise<ApiResult<{ status: DescribeOutcome["status"] }>> {
  return request<{ status: DescribeOutcome["status"] }>(
    API_ROUTES.status(sessionId),
    { method: "GET" },
  );
}
