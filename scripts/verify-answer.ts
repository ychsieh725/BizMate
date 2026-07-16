/**
 * 驗證反問回合的端到端行為（任務 4.2 驗收）。
 * 執行：npm run verify:answer
 *
 * 補上單元測試的邊界：單元測試 mock 了 Parser/Agent/DB，此腳本實際串接
 * describe → answer 迴圈，對真實 Gemini + Supabase 跑一輪完整反問：
 * 故意給模糊描述 → 觸發反問 → 依序回答 → 看續問 / 出報價 / 保守估算。
 *
 * 前置：需先套用多租戶 migrations 並跑過 pnpm seed:rate-card。
 * 會建立測試 session 與相關資料，驗收後可自行於 Supabase Studio 清除。
 */
import { createSession } from "@/domains/intake/sessionService.ts";
import { handleDescribe } from "@/orchestrator/describeFlow.ts";
import { handleAnswer } from "@/orchestrator/answerFlow.ts";
import type { FlowOutcome } from "@/orchestrator/flowOutcome.ts";
import { ensureDevMerchant } from "./dev-merchant.ts";

/** 各缺漏欄位的預備答案（批次反問：一輪一次回答所有被問到的欄位）。 */
const ANSWER_BY_FIELD: Record<string, string> = {
  subtype: "角色設計",
  quantity: "一張",
  license_scope: "商業使用",
  deadline_days: "兩週內完成",
  coloring_complexity: "全彩細緻",
  includes_pitch_rounds: "一次提案",
  page_count: "五頁",
  feature_modules: "無特殊功能",
  includes_rwd: "需要",
  includes_cms: "不需要",
};

function printOutcome(label: string, outcome: FlowOutcome): void {
  console.log(`\n[${label}] status=${outcome.status}`);
  for (const item of outcome.questions ?? []) {
    console.log(`  反問（${item.targetField}）：${item.question}`);
  }
  if (outcome.quoteCode) {
    console.log(
      `  報價：${outcome.quoteCode}${outcome.conservative ? "（保守估算）" : ""}${
        outcome.outOfScope ? "（超出範圍）" : ""
      }`,
    );
  }
}

async function main(): Promise<void> {
  const merchantId = await ensureDevMerchant();
  const { sessionId } = await createSession("illustration", merchantId);
  console.log("session:", sessionId);

  let result = await handleDescribe({
    sessionId,
    rawText: "幫我畫一張圖", // 故意模糊，觸發反問
    contactEmail: "test@example.com",
  });
  if (!result.ok) throw new Error(`describe 失敗：${JSON.stringify(result)}`);
  printOutcome("describe", result.outcome);

  let round = 0;
  while (
    result.ok &&
    result.outcome.status === "awaiting_clarification" &&
    (result.outcome.questions?.length ?? 0) > 0 &&
    round < 3
  ) {
    // 批次：一次回答本輪被問到的所有欄位
    const answers = (result.outcome.questions ?? []).map((item) => ({
      field: item.targetField,
      answer: ANSWER_BY_FIELD[item.targetField] ?? "沒有特別要求",
    }));
    console.log(`\n→ 回答：${answers.map((a) => `${a.field}=${a.answer}`).join("、")}`);
    const next = await handleAnswer({ sessionId, answers });
    if (!next.ok) throw new Error(`answer 失敗：${JSON.stringify(next)}`);
    result = next;
    printOutcome(`answer #${round + 1}`, result.outcome);
    round += 1;
  }

  console.log("\n🎉 反問回合驗收完成（describe → answer 迴圈 → 出報價 / 保守估算）。");
}

main().catch((error: unknown) => {
  console.error("驗證腳本執行失敗：", error);
  process.exit(1);
});
