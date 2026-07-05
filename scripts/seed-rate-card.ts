/**
 * Rate Card 種子資料（任務 2.7）。
 * 執行：pnpm seed:rate-card
 *
 * 依 PRD 附錄 A 建立完整定價結構，數字為 **示意值（demo，幣別 TWD）**，
 * 讓報價流程能跑、demo 有說服力。你之後可在 Supabase Studio 直接改成真實
 * 費率（ADR-3：改表即生效，不需重新部署）。
 *
 * 冪等：只有在資料表為空時才灌入，避免覆蓋你已編輯的費率。
 */
import { BaseRepository } from "@/lib/supabase/repository.ts";
import { BASE_ROWS, MODIFIER_ROWS } from "./rate-card-data.ts";

async function main(): Promise<void> {
  const baseRepo = new BaseRepository("rate_card_base");
  const modifierRepo = new BaseRepository("rate_card_modifiers");

  const existingBase = await baseRepo.findAll();
  const existingModifiers = await modifierRepo.findAll();

  if (existingBase.length > 0 || existingModifiers.length > 0) {
    console.log(
      `⏭️ 已有資料（base=${existingBase.length}, modifiers=${existingModifiers.length}），跳過灌入以保護既有編輯。`,
    );
    console.log("   如需重灌，請先在 Supabase Studio 清空這兩張表。");
    return;
  }

  for (const row of BASE_ROWS) {
    await baseRepo.create(row);
  }
  for (const row of MODIFIER_ROWS) {
    await modifierRepo.create(row);
  }

  console.log(
    `🎉 種子完成：rate_card_base ${BASE_ROWS.length} 筆、rate_card_modifiers ${MODIFIER_ROWS.length} 筆（TWD 示意值）。`,
  );
  console.log("   請至 Supabase Studio 依你的真實費率調整（改表即生效，不需重新部署）。");
}

main().catch((error: unknown) => {
  console.error("種子腳本執行失敗：", error);
  process.exit(1);
});
