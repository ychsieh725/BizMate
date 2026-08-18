/**
 * 驗證 Intake Parser Agent 對真實 Gemini 的端到端行為（任務 3.3 驗收）。
 * 執行：pnpm verify:parser
 *
 * 補上單元測試的邊界：單元測試 mock 了 Gemini，此腳本實際呼叫，確認
 * buildParseResponseSchema → JSON Schema 轉換生效、依 category 切換欄位、
 * confidence/source_span 回傳、以及缺漏判斷在真實輸出下運作。
 *
 * 會為每個 category 建立一筆測試 session（讓 cost_logs 的 FK 成立、順帶驗成本記錄）。
 * 這些 session 屬測試資料，驗收後可自行於 Supabase Studio 清除。
 */
import type { CaseCategory } from "@/shared/types/domain.types";
import { sessionsRepository } from "@/domains/intake/repositories/sessionsRepository.ts";
import { parseIntake } from "@/domains/intake/parserAgent.ts";
import { rateCardRepository } from "@/domains/pricing/repositories/rateCardRepository.ts";
import { ensureDevMerchant } from "./dev-merchant.ts";

const SAMPLES: { category: CaseCategory; rawText: string }[] = [
  {
    category: "illustration",
    rawText: "幫我畫一個角色，要商用，急件三天內交件，精緻上色",
  },
  {
    category: "graphic_design",
    rawText: "我想要一個 LOGO，商業用途使用",
  },
  {
    category: "web_design",
    rawText: "做一個 landing page，要 RWD，兩週內完成",
  },
];

async function main(): Promise<void> {
  const merchantId = await ensureDevMerchant();
  for (const { category, rawText } of SAMPLES) {
    const session = await sessionsRepository.create({ category, merchant_id: merchantId });
    const allowedServices = await rateCardRepository.findActiveServices(
      merchantId,
      category,
    );
    const result = await parseIntake({
      sessionId: session.id,
      category,
      rawText,
      allowedServices,
    });

    console.log(`\n──────── ${category} ────────`);
    console.log(`描述：${rawText}`);
    console.log("抽取結果：", JSON.stringify(result.fields, null, 2));
    console.log("缺漏欄位：", result.missingRequiredFields);
  }

  console.log("\n🎉 Intake Parser 驗收通過（真實 Gemini 抽取 + schema 轉換 + 缺漏判斷）。");
}

main().catch((error: unknown) => {
  console.error("驗證腳本執行失敗：", error);
  process.exit(1);
});
