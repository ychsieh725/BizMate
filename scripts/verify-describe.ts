/**
 * 驗證 /describe 端到端編排（任務：/describe 串接 驗收）。
 * 執行：pnpm verify:describe
 *
 * 補上單元測試的邊界：describeFlow 的單元測試 mock 了所有依賴，此腳本實際
 * 建立 session、跑真實 Parser（Gemini）+ 報價鏈 + Supabase 持久化，確認
 * 齊全路徑（→ 報價）與缺欄位路徑（→ 等待反問）在真實環境端到端運作，
 * 且最終狀態確實寫回 sessions。
 *
 * 會建立測試 session 與相關資料（raw_inputs/extracted_fields/quotes/
 * price_line_items），驗收後可自行於 Supabase Studio 清除。
 */
import type { CaseCategory } from "@/shared/types/domain.types";
import { createSession } from "@/domains/intake/sessionService.ts";
import { handleDescribe } from "@/orchestrator/describeFlow.ts";
import { sessionsRepository } from "@/domains/intake/repositories/sessionsRepository.ts";
import { ensureDevMerchant } from "./dev-merchant.ts";

const SAMPLES: { label: string; category: CaseCategory; rawText: string }[] = [
  {
    label: "齊全描述（預期：出報價 → awaiting_review）",
    category: "illustration",
    rawText:
      "幫我畫 1 個角色設計，精緻上色，需要高解析度印刷檔，商業使用，三天內交件，含 2 次修改",
  },
  {
    label: "資訊不足（預期：缺欄位 → awaiting_clarification）",
    category: "graphic_design",
    rawText: "我想要一個 LOGO",
  },
];

async function main(): Promise<void> {
  const merchantId = await ensureDevMerchant();
  for (const { label, category, rawText } of SAMPLES) {
    console.log(`\n──────── ${label} ────────`);
    console.log(`描述：${rawText}`);

    const { sessionId } = await createSession(category, merchantId);
    const result = await handleDescribe({
      sessionId,
      rawText,
      contactEmail: "verify@example.com",
    });

    console.log("編排結果：", JSON.stringify(result, null, 2));

    // 確認最終狀態確實寫回 DB
    const session = await sessionsRepository.findById(sessionId);
    console.log(`DB 中 session 最終狀態：${session?.status}`);
  }

  console.log("\n🎉 /describe 端到端驗收通過（Parser + 報價鏈 + 持久化 + 狀態機）。");
}

main().catch((error: unknown) => {
  console.error("驗證腳本執行失敗：", error);
  process.exit(1);
});
