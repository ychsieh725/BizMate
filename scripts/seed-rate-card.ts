/**
 * 多租戶種子腳本。執行：pnpm seed:rate-card
 *
 * 做三件事（皆冪等，可重複執行）：
 * 1. 灌入 rate_card_template_* 全域範本（表非空則跳過）
 * 2. 建立 dev 商家（auth user dev@bizmate.local + merchants 列，slug=dev）
 *    —— M1 尚無註冊流程，本機驗證 /q/dev 全流程用
 * 3. 把範本複製到 dev 商家名下（已有價目表則跳過）
 */
import { BaseRepository } from "@/lib/supabase/repository.ts";
import { copyTemplateRateCard } from "@/domains/merchant/onboardingService.ts";
import { BASE_ROWS, MODIFIER_ROWS } from "./rate-card-data.ts";
import { DEV_MERCHANT, ensureDevMerchant } from "./dev-merchant.ts";

async function seedTemplates(): Promise<void> {
  const baseRepo = new BaseRepository("rate_card_template_base");
  const modifierRepo = new BaseRepository("rate_card_template_modifiers");

  const existingBase = await baseRepo.findAll();
  const existingModifiers = await modifierRepo.findAll();
  if (existingBase.length > 0 || existingModifiers.length > 0) {
    console.log(
      `⏭️ 範本已有資料（base=${existingBase.length}, modifiers=${existingModifiers.length}），跳過灌入。`,
    );
    return;
  }

  for (const row of BASE_ROWS) {
    await baseRepo.create(row);
  }
  for (const row of MODIFIER_ROWS) {
    await modifierRepo.create(row);
  }
  console.log(
    `✅ 範本完成：template_base ${BASE_ROWS.length} 筆、template_modifiers ${MODIFIER_ROWS.length} 筆（TWD 建議值）。`,
  );
}

async function main(): Promise<void> {
  await seedTemplates();
  const merchantId = await ensureDevMerchant();
  console.log(`✅ dev 商家就緒：/q/${DEV_MERCHANT.slug}（merchant_id=${merchantId}）`);

  const { baseCount, modifierCount } = await copyTemplateRateCard(merchantId);
  if (baseCount === 0 && modifierCount === 0) {
    console.log("⏭️ dev 商家已有價目表，跳過複製以保護既有編輯。");
  } else {
    console.log(`✅ 已複製範本到 dev 商家：base ${baseCount} 筆、modifiers ${modifierCount} 筆。`);
  }

  console.log("🎉 種子完成。本機開發可直接開 http://localhost:3000/q/dev 跑報價全流程。");
}

main().catch((error: unknown) => {
  console.error("種子腳本執行失敗：", error);
  process.exit(1);
});
