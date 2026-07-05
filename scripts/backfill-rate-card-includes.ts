/**
 * 回填 rate_card_base.includes（一次性）。
 * 執行：pnpm backfill:rate-card-includes
 *
 * 背景：includes 欄位（migration 0002）加上後，既有 13 筆資料為 NULL。
 * seed 腳本冪等、偵測到已有資料會整個跳過，故無法用來回填。此腳本依
 * (category, subtype) 對照 seed 的 BASE_ROWS，逐筆補上示意說明。
 *
 * 安全性：
 * - 只更新 includes 目前為空的列，**不覆蓋**你已在 Studio 手填的內容。
 * - 冪等：重跑時已填過的列會被略過。
 */
import { BaseRepository } from "@/lib/supabase/repository.ts";
import { BASE_ROWS } from "./rate-card-data.ts";

/** (category, subtype) → includes 對照，來源為 BASE_ROWS（單一事實來源） */
const INCLUDES_BY_KEY = new Map<string, string>(
  BASE_ROWS.filter((row) => row.includes != null).map((row) => [
    `${row.category}::${row.subtype}`,
    row.includes as string,
  ]),
);

async function main(): Promise<void> {
  const repo = new BaseRepository("rate_card_base");
  const rows = await repo.findAll();

  let updated = 0;
  let skippedFilled = 0;
  let skippedNoSeed = 0;

  for (const row of rows) {
    if (row.includes != null && row.includes.trim() !== "") {
      skippedFilled += 1;
      continue;
    }
    const includes = INCLUDES_BY_KEY.get(`${row.category}::${row.subtype}`);
    if (includes == null) {
      skippedNoSeed += 1;
      console.warn(`⚠️ 無對應示意內容，略過：${row.category} / ${row.subtype}`);
      continue;
    }
    await repo.update(row.id, { includes });
    updated += 1;
    console.log(`✅ ${row.category} / ${row.subtype}`);
  }

  console.log(
    `\n🎉 回填完成：更新 ${updated} 筆、已有內容略過 ${skippedFilled} 筆、無對照略過 ${skippedNoSeed} 筆。`,
  );
}

main().catch((error: unknown) => {
  console.error("回填腳本執行失敗：", error);
  process.exit(1);
});
