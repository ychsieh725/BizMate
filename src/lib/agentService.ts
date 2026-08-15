/**
 * agent-service（Python / FastAPI）的 HTTP client。
 *
 * 設計約束來自不變式 I-3「agent 失控必須退回現行路徑」：
 * **本模組的任何函式都不得拋例外。** 所有失敗——逾時、連線不通、認證失敗、
 * 回應形狀不對——一律轉成帶 reason 的結果，交由 orchestrator 決定 fallback。
 * 一旦這裡拋出，route 會回 500，使用者看到錯誤而非降級後的正常流程，I-3 即失效。
 *
 * 刻意**不重試**：重試會吃掉留給 fallback 的時間預算，而 fallback 本身就是
 * 更可靠的降級路徑。與其重試一個不健康的服務，不如立刻走本地的
 * resolveAfterParse——後者不依賴網路，且結果與 agent 化之前完全一致。
 */

/** 呼叫失敗的分類，供上層記錄告警與決定處置。 */
export type AgentServiceFailureReason =
  /** 未設定服務位址——多半是環境變數漏設，屬部署疏漏 */
  | "not_configured"
  /** 逾時 */
  | "timeout"
  /** 連線不通（DNS、TLS、網路） */
  | "unreachable"
  /** 內部認證失敗——secret 兩端不一致 */
  | "unauthorized"
  /** 服務回報錯誤（HTTP 5xx，或信封 success=false） */
  | "service_error"
  /** 回應不是預期的信封形狀（如打到錯的服務、收到 HTML 錯誤頁） */
  | "invalid_response";

export type AgentServiceResult<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly reason: AgentServiceFailureReason;
      readonly detail: string;
    };

/**
 * 呼叫逾時。
 *
 * 分層預算（設計文件〈延遲預算〉）：
 *   route maxDuration 180s > 本逾時 90s > Python loop 預算 60s
 * 逾時後仍須留有時間讓 orchestrator 跑完 fallback，故不可貼近 route 上限。
 */
const AGENT_TIMEOUT_MS = 90_000;

/** 統一信封的最小形狀檢查——只驗證結構，不驗證 data 的內容。 */
type Envelope = {
  success: boolean;
  data: unknown;
  error: string | null;
};

function isEnvelope(value: unknown): value is Envelope {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.success === "boolean" &&
    "data" in candidate &&
    (typeof candidate.error === "string" || candidate.error === null)
  );
}

/** 把 fetch 拋出的例外分類成 reason；無法辨識者一律歸為 unreachable。 */
function classifyThrown(error: unknown): {
  reason: AgentServiceFailureReason;
  detail: string;
} {
  const detail = error instanceof Error ? error.message : String(error);
  const isTimeout =
    error instanceof DOMException &&
    (error.name === "TimeoutError" || error.name === "AbortError");

  return { reason: isTimeout ? "timeout" : "unreachable", detail };
}

/** HTTP 狀態碼 → reason。 */
function classifyStatus(status: number): AgentServiceFailureReason {
  if (status === 401 || status === 403) return "unauthorized";
  return "service_error";
}

/**
 * 對 agent-service 發出一次 POST 請求。
 *
 * @param path 服務端路徑，如 `/agent/echo`
 * @param body 請求主體（會被序列化為 JSON）
 */
export async function callAgentService<T = unknown>(
  path: string,
  body: unknown,
): Promise<AgentServiceResult<T>> {
  const baseUrl = process.env.AGENT_SERVICE_URL;
  const secret = process.env.INTERNAL_SERVICE_SECRET;

  if (!baseUrl || !secret) {
    return {
      ok: false,
      reason: "not_configured",
      detail: "AGENT_SERVICE_URL 或 INTERNAL_SERVICE_SECRET 未設定",
    };
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": secret,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(AGENT_TIMEOUT_MS),
    });
  } catch (error) {
    const { reason, detail } = classifyThrown(error);
    return { ok: false, reason, detail };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    // 收到非 JSON——通常代表打到了錯誤的服務，或中間層回了 HTML 錯誤頁
    return {
      ok: false,
      reason: response.ok ? "invalid_response" : classifyStatus(response.status),
      detail: `回應非 JSON（HTTP ${response.status}）`,
    };
  }

  if (!isEnvelope(payload)) {
    return {
      ok: false,
      reason: "invalid_response",
      detail: `回應不符信封格式（HTTP ${response.status}）`,
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: classifyStatus(response.status),
      detail: payload.error ?? `HTTP ${response.status}`,
    };
  }

  // HTTP 200 但信封標記失敗：服務有意回報的業務層錯誤
  if (!payload.success) {
    return {
      ok: false,
      reason: "service_error",
      detail: payload.error ?? "服務回報失敗但未附訊息",
    };
  }

  return { ok: true, data: payload.data as T };
}
