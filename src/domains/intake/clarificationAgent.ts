import { z } from "zod";
import type { CaseCategory } from "@/shared/types/domain.types";
import { CASE_CATEGORY_LABELS } from "@/shared/constants/categories.ts";
import { fieldLabel } from "@/shared/constants/fieldLabels.ts";
import { generateStructuredAndLog } from "@/domains/finops/costLogger.ts";

/** Clarification Agent 的輸出（SDS §6.2）。 */
export interface ClarificationQuestion {
  readonly question: string;
  readonly targetField: string;
}

/**
 * 系統指令。target_field 已由程式端 selectNextField 選定，這裡只請 LLM 生成
 * 「針對該欄位」的一句自然語言問題——LLM 不決定要問哪一欄，故 AC「target_field
 * 必為缺漏清單成員」由設計保證，同時杜絕 LLM 自創欄位（prompt injection 防線）。
 */
const SYSTEM_INSTRUCTION = [
  "你是接案報價系統的客服助手。客戶的需求描述缺少某一項資訊，你的唯一任務是針對「指定的那一項」，生成一句簡短、口語、友善的中文問題來詢問客戶。",
  "規則：",
  "1. 只針對指定的欄位發問，一次只問這一項，不要順帶問其他資訊。",
  "2. 用自然、親切的口語，像真人客服，不要用生硬的欄位名稱。",
  "3. 只回傳一句問句，不要加解釋或選項清單。",
].join("\n");

/** 組出「請針對某欄位發問」的中文 prompt。 */
function buildPrompt(category: CaseCategory, targetField: string): string {
  return [
    `案件類型：${CASE_CATEGORY_LABELS[category]}`,
    `需要向客戶詢問的資訊：${fieldLabel(targetField)}`,
    "",
    "請生成一句詢問這項資訊的問題。",
  ].join("\n");
}

/** LLM 只回一句問題；target_field 不交給 LLM（由程式端決定）。 */
const clarificationSchema = z.object({
  question: z.string(),
});

/**
 * 針對指定的缺漏欄位，生成一句自然語言反問（Clarification Agent，FR-CL-1）。
 * 用 Flash-Lite（light tier）+ 自動記成本。targetField 由呼叫端（selectNextField）
 * 選定並原樣回傳，保證落在缺漏清單內。
 */
export async function generateClarificationQuestion(params: {
  sessionId: string;
  category: CaseCategory;
  targetField: string;
}): Promise<ClarificationQuestion> {
  const { sessionId, category, targetField } = params;

  const result = await generateStructuredAndLog({
    tier: "light",
    agentName: "clarification",
    sessionId,
    systemInstruction: SYSTEM_INSTRUCTION,
    prompt: buildPrompt(category, targetField),
    schema: clarificationSchema,
  });

  return { question: result.data.question, targetField };
}
