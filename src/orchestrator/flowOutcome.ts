import type { SessionStatus } from "@/shared/types/domain.types";

/**
 * describe / answer 解析後的統一結果（對應 SDS §5.1 的多種回應）。
 * 純資料 + 序列化，無副作用依賴——route 可安全 import 而不觸發底層 env 驗證。
 */
export interface FlowOutcome {
  readonly status: SessionStatus;
  /** 續問路徑：仍缺哪些必要欄位。 */
  readonly missingFields?: string[];
  /** 續問路徑：本輪反問的問題與目標欄位。 */
  readonly question?: string;
  readonly targetField?: string;
  /** 出報價路徑：配發的報價編號。 */
  readonly quoteCode?: string;
  /** 出報價路徑：是否超出 rate card 範圍（需人工評估）。 */
  readonly outOfScope?: boolean;
  /** 出報價路徑：是否為反問用盡後的保守估算（FR-CL-3）。 */
  readonly conservative?: boolean;
}

/** 把 FlowOutcome 轉成 API 回應的 snake_case 酬載（describe / answer route 共用）。 */
export function serializeFlowOutcome(
  outcome: FlowOutcome,
): Record<string, unknown> {
  return {
    status: outcome.status,
    ...(outcome.missingFields ? { missing_fields: outcome.missingFields } : {}),
    ...(outcome.question ? { question: outcome.question } : {}),
    ...(outcome.targetField ? { target_field: outcome.targetField } : {}),
    ...(outcome.quoteCode ? { quote_code: outcome.quoteCode } : {}),
    ...(outcome.outOfScope !== undefined
      ? { out_of_scope: outcome.outOfScope }
      : {}),
    ...(outcome.conservative !== undefined
      ? { conservative: outcome.conservative }
      : {}),
  };
}
