import { z } from "zod";

import { apiOk, apiFail } from "@/lib/api/response.ts";
import { isInternalRequestAuthorized } from "@/lib/api/internalAuth.ts";
import { computeBasePricing } from "@/domains/pricing/basePricing.ts";
import { CASE_CATEGORIES } from "@/shared/constants/categories.ts";
import type { CaseCategory } from "@/shared/types/domain.types";
import type { PricingResult } from "@/domains/pricing/pricingTypes.ts";

/**
 * POST /api/internal/pricing/compute — 供 agent-service 取得計價結果。
 *
 * **這是不變式 I-1 的落地點。** 計價邏輯留在 TypeScript 服務內，Python agent
 * 只能透過這個端點取得金額——它在架構上沒有能力修改計價程式碼，也沒有管道
 * 影響計算結果。
 *
 * 為此，請求主體刻意**只接受欄位值**：
 * - 沒有任何金額參數，夾帶 total / amount 之類的鍵會被 schema 忽略
 * - 回傳金額完全由 computeBasePricing 依 rate card 算出
 *
 * 「約定 agent 不能算錢」會被違反，「agent 拿不到算錢的手段」不會。
 */

/** 計價只需要各欄位的字串值，不需要 confidence / source_span。 */
const fieldValueSchema = z.object({
  value: z.string().nullable(),
});

const computeBodySchema = z.object({
  merchant_id: z.uuid("必須是合法的 UUID"),
  // 從單一事實來源衍生，不重複列舉（沿用 sessionSchemas.ts 的既有寫法）
  category: z.enum(CASE_CATEGORIES as readonly [CaseCategory, ...CaseCategory[]]),
  fields: z.record(z.string(), fieldValueSchema),
});

/** 轉成 snake_case 酬載，與專案其他 API 的對外形狀一致。 */
function serializePricing(result: PricingResult): Record<string, unknown> {
  return {
    total: result.total,
    out_of_scope: result.outOfScope,
    line_items: result.lineItems.map((item) => ({
      item_name: item.itemName,
      amount: item.amount,
      rule_id: item.ruleId,
      modifier_id: item.modifierId,
      agent_reasoning: item.agentReasoning,
    })),
  };
}

export async function POST(request: Request): Promise<Response> {
  // 認證先於一切：非法請求不該有機會觸發解析或計價
  if (!isInternalRequestAuthorized(request)) {
    return apiFail("內部服務認證失敗", 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiFail("請求主體必須是合法的 JSON", 400);
  }

  const parsed = computeBodySchema.safeParse(body);
  if (!parsed.success) {
    return apiFail(`請求內容不合規格：${parsed.error.issues[0]?.message}`, 400);
  }

  try {
    const result = await computeBasePricing(
      parsed.data.merchant_id,
      parsed.data.category,
      parsed.data.fields,
    );
    return apiOk(serializePricing(result));
  } catch (error) {
    console.error("[POST /api/internal/pricing/compute] 計價失敗：", error);
    return apiFail("計價失敗", 500);
  }
}
