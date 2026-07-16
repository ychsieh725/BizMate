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

/** describe / answer 回傳的原始（snake_case）資料形狀（兩端共用）。 */
type FlowResponseData = {
  status: DescribeOutcome["status"];
  missing_fields?: readonly string[];
  questions?: readonly { question: string; target_field: string }[];
  quote_code?: string;
  out_of_scope?: boolean;
  conservative?: boolean;
};

/** snake_case 回應 → camelCase DescribeOutcome（describe / answer 共用）。 */
function toOutcome(data: FlowResponseData): DescribeOutcome {
  const { status, missing_fields, questions, quote_code, out_of_scope, conservative } = data;
  return {
    status,
    ...(missing_fields ? { missingFields: missing_fields } : {}),
    ...(questions
      ? {
          questions: questions.map((item) => ({
            question: item.question,
            targetField: item.target_field,
          })),
        }
      : {}),
    ...(quote_code ? { quoteCode: quote_code } : {}),
    ...(out_of_scope !== undefined ? { outOfScope: out_of_scope } : {}),
    ...(conservative !== undefined ? { conservative } : {}),
  };
}

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
  const result = await request<FlowResponseData>(
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
  return { ok: true, data: toOutcome(result.data) };
}

/**
 * Step 3：一次回答本輪所有反問。打同一 session 的 /answer 端點——後端以「原始
 * 描述 + 累積問答」重新解析，回傳下一輪反問 / 出報價 / 保守估算。絕不建立新
 * session，故客戶不需要重述先前描述。answers 每筆對應一個 targetField。
 */
export async function submitAnswer(
  sessionId: string,
  answers: readonly { field: string; answer: string }[],
): Promise<ApiResult<DescribeOutcome>> {
  const result = await request<FlowResponseData>(API_ROUTES.answer(sessionId), {
    method: "POST",
    body: JSON.stringify({ answers }),
  });
  if (!result.ok) return result;
  return { ok: true, data: toOutcome(result.data) };
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
