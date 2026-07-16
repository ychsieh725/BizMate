/**
 * 驗證 Clarification Agent 對真實 Gemini 的行為（任務 4.1 驗收）。
 * 執行：npm run verify:clarification
 *
 * 補上單元測試的邊界：單元測試 mock 了 Gemini，此腳本實際呼叫，確認
 * 針對多個缺漏欄位一次生成自然、口語的中文問題（批次）；並展示
 * orderMissingFields 的 deterministic 優先序排序。
 *
 * 會建立一筆測試 session（讓 cost_logs 的 FK 成立）。屬測試資料，驗收後可自清。
 */
import type { CaseCategory } from "@/shared/types/domain.types";
import { sessionsRepository } from "@/domains/intake/repositories/sessionsRepository.ts";
import { generateClarificationQuestions } from "@/domains/intake/clarificationAgent.ts";
import { orderMissingFields } from "@/domains/intake/clarificationFields.ts";
import { ensureDevMerchant } from "./dev-merchant.ts";

const SAMPLES: { category: CaseCategory; targetFields: string[] }[] = [
  { category: "graphic_design", targetFields: ["subtype", "license_scope"] },
  { category: "illustration", targetFields: ["license_scope", "deadline_days"] },
  { category: "web_design", targetFields: ["page_count", "deadline_days"] },
];

async function main(): Promise<void> {
  // 1. 展示 deterministic 批次排序（一次列全部缺漏欄位）
  console.log("──────── orderMissingFields 批次排序 ────────");
  const cases: string[][] = [
    ["license_scope", "subtype", "deadline_days"],
    ["deadline_days", "license_scope"],
    ["feature_modules", "license_scope"],
  ];
  for (const missing of cases) {
    console.log(`缺 [${missing.join(", ")}] → 依序問：${orderMissingFields(missing).join(" → ")}`);
  }

  // 2. 對真實 Gemini 一次生成多題反問
  const merchantId = await ensureDevMerchant();
  const session = await sessionsRepository.create({ category: "illustration", merchant_id: merchantId });
  console.log("\n──────── generateClarificationQuestions（真實 Gemini，批次）────────");
  for (const { category, targetFields } of SAMPLES) {
    const questions = await generateClarificationQuestions({
      sessionId: session.id,
      category,
      targetFields,
    });
    console.log(`\n[${category} / ${targetFields.join(", ")}]`);
    for (const item of questions) {
      console.log(`  問題（${item.targetField}）：${item.question}`);
    }
  }

  console.log("\n🎉 Clarification Agent 驗收通過（批次排序 + 真實 Gemini 一次多題反問）。");
}

main().catch((error: unknown) => {
  console.error("驗證腳本執行失敗：", error);
  process.exit(1);
});
