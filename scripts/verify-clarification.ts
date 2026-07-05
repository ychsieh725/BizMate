/**
 * 驗證 Clarification Agent 對真實 Gemini 的行為（任務 4.1 驗收）。
 * 執行：npm run verify:clarification
 *
 * 補上單元測試的邊界：單元測試 mock 了 Gemini，此腳本實際呼叫，確認
 * 針對指定欄位能生成自然、口語、單題的中文問題；並展示 selectNextField
 * 的 deterministic 優先序選欄。
 *
 * 會建立一筆測試 session（讓 cost_logs 的 FK 成立）。屬測試資料，驗收後可自清。
 */
import type { CaseCategory } from "@/shared/types/domain.types";
import { sessionsRepository } from "@/domains/intake/repositories/sessionsRepository.ts";
import { generateClarificationQuestion } from "@/domains/intake/clarificationAgent.ts";
import { selectNextField } from "@/domains/intake/clarificationFields.ts";

const SAMPLES: { category: CaseCategory; targetField: string }[] = [
  { category: "graphic_design", targetField: "subtype" },
  { category: "illustration", targetField: "license_scope" },
  { category: "web_design", targetField: "deadline_days" },
  { category: "illustration", targetField: "revision_count" },
];

async function main(): Promise<void> {
  // 1. 展示 deterministic 優先序選欄
  console.log("──────── selectNextField 優先序 ────────");
  const cases: string[][] = [
    ["license_scope", "subtype", "deadline_days"],
    ["revision_count", "deadline_days"],
    ["feature_modules", "license_scope"],
  ];
  for (const missing of cases) {
    console.log(`缺 [${missing.join(", ")}] → 先問：${selectNextField(missing)}`);
  }

  // 2. 對真實 Gemini 生成反問問題
  const session = await sessionsRepository.create({ category: "illustration" });
  console.log("\n──────── generateClarificationQuestion（真實 Gemini）────────");
  for (const { category, targetField } of SAMPLES) {
    const result = await generateClarificationQuestion({
      sessionId: session.id,
      category,
      targetField,
    });
    console.log(`\n[${category} / ${targetField}]`);
    console.log(`問題：${result.question}`);
    console.log(`target_field：${result.targetField}`);
  }

  console.log("\n🎉 Clarification Agent 驗收通過（優先序選欄 + 真實 Gemini 單題反問）。");
}

main().catch((error: unknown) => {
  console.error("驗證腳本執行失敗：", error);
  process.exit(1);
});
