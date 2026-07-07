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

/** 依序回答反問的預備答案（涵蓋常見缺漏欄位）。 */
const ANSWERS = ["角色設計一張", "商業使用", "兩週內完成", "含兩次修改"];

function printOutcome(label: string, outcome: FlowOutcome): void {
  console.log(`\n[${label}] status=${outcome.status}`);
  if (outcome.question) {
    console.log(`  反問（${outcome.targetField}）：${outcome.question}`);
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
    round < ANSWERS.length
  ) {
    const answer = ANSWERS[round];
    console.log(`\n→ 回答：${answer}`);
    const next = await handleAnswer({ sessionId, answer });
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
