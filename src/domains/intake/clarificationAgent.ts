import { z } from "zod";
import type { CaseCategory } from "@/shared/types/domain.types";
import { CASE_CATEGORY_LABELS } from "@/shared/constants/categories.ts";
import { fieldLabel } from "@/shared/constants/fieldLabels.ts";
import { generateStructuredAndLog } from "@/domains/finops/costLogger.ts";

/** Clarification Agent 的單一問題輸出（SDS §6.2）。 */
export interface ClarificationQuestion {
  readonly question: string;
  readonly targetField: string;
}

/**
 * 系統指令。target_field 一律由程式端決定（selectNextField/orderMissingFields），
 * LLM 只負責把每個「指定欄位」轉成一句自然、友善的中文問句。批次模式下一次問
 * 多欄，但每欄各出一句、彼此獨立——AC「target_field 必為缺漏清單成員」由設計
 * 保證，也杜絕 LLM 自創欄位（prompt injection 防線）。
 */
const SYSTEM_INSTRUCTION = [
  "你是接案報價系統的客服助手。客戶的需求描述缺少幾項資訊，你要針對「指定的每一項」各生成一句簡短、口語、友善的中文問題來詢問客戶。",
  "規則：",
  "1. 依指定欄位的順序，每一項各生成一句問句，數量與順序必須與指定清單完全一致。",
  "2. 用自然、親切的口語，像真人客服，不要用生硬的欄位名稱。",
  "3. 每句只問對應的那一項，不要在同一句裡順帶問其他資訊。",
  "4. questions 陣列只放問句字串，不要加解釋或選項清單。",
].join("\n");

/** 組出「請針對這些欄位各發一問」的中文 prompt。 */
function buildPrompt(category: CaseCategory, targetFields: readonly string[]): string {
  const list = targetFields
    .map((field, index) => `${index + 1}. ${fieldLabel(field)}`)
    .join("\n");
  return [
    `案件類型：${CASE_CATEGORY_LABELS[category]}`,
    "需要向客戶詢問的資訊（請依此順序，每項各生成一句問題）：",
    list,
    "",
    `請回傳 ${targetFields.length} 句問題，順序與上面一致。`,
  ].join("\n");
}

/** LLM 只回問句字串陣列；target_field 由程式端依索引對齊（不交給 LLM）。 */
const clarificationSchema = z.object({
  questions: z.array(z.string()),
});

/**
 * 針對全部缺漏欄位一次生成多句反問（批次 Clarification，FR-CL-1）。
 * 用 Flash-Lite（light tier）+ 自動記成本，**一次 LLM 呼叫**產生所有問題，
 * 避免逐欄呼叫造成的多次往返（SAD R-1 Vercel 逾時）。
 * targetFields 由呼叫端（orderMissingFields）排定，questions 依索引與其對齊；
 * 若 LLM 回傳數量不足，缺的那句以欄位標籤兜底，確保每欄都有問題可問。
 */
export async function generateClarificationQuestions(params: {
  sessionId: string;
  category: CaseCategory;
  targetFields: readonly string[];
}): Promise<ClarificationQuestion[]> {
  const { sessionId, category, targetFields } = params;
  if (targetFields.length === 0) return [];

  const result = await generateStructuredAndLog({
    tier: "light",
    agentName: "clarification",
    sessionId,
    systemInstruction: SYSTEM_INSTRUCTION,
    prompt: buildPrompt(category, targetFields),
    schema: clarificationSchema,
  });

  const questions = result.data.questions;
  return targetFields.map((targetField, index) => ({
    targetField,
    question: questions[index] ?? `請補充「${fieldLabel(targetField)}」的資訊。`,
  }));
}
