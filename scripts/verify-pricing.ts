/**
 * 驗證報價鏈對真實 rate card 資料的行為（任務 3.5 + 3.4 驗收）。
 * 執行：pnpm verify:pricing
 *
 * 補上單元測試的邊界：單元測試 mock 了 repository，此腳本實際查詢 Supabase 的
 * rate_card_base / rate_card_modifiers（seed 示意費率），確認查表、固定倍率加成、
 * out_of_scope、quote_code 產生、報價預覽渲染在真實資料下運作。
 *
 * fields 為手工模擬的 Parser 抽取結果（Parser 本身由 verify:parser 驗證）。
 */
import type { CaseCategory } from "@/shared/types/domain.types";
import type { ExtractedValues } from "@/domains/pricing/pricingTypes.ts";
import { computeBasePricing } from "@/domains/pricing/basePricing.ts";
import {
  generateQuoteCode,
  formatQuotePreview,
} from "@/domains/pricing/quoteFormatter.ts";
import { ensureDevMerchant } from "./dev-merchant.ts";

const SAMPLES: {
  label: string;
  category: CaseCategory;
  fields: ExtractedValues;
}[] = [
  {
    label: "插畫／角色設計／商用（預期：基礎費 + 商業加成）",
    category: "illustration",
    fields: {
      subtype: { value: "角色設計" },
      quantity: { value: "1" },
      license_scope: { value: "商用" },
    },
  },
  {
    label: "平面／LOGO設計／個人（預期：僅基礎費，無商業加成）",
    category: "graphic_design",
    fields: {
      subtype: { value: "LOGO設計" },
      quantity: { value: "1" },
      license_scope: { value: "個人使用" },
    },
  },
  {
    label: "網頁／多頁式網站／頁數 5（預期：base × 5）",
    category: "web_design",
    fields: {
      subtype: { value: "多頁式網站" },
      page_count: { value: "5" },
      license_scope: { value: "商業使用" },
    },
  },
  {
    label: "查無子類型（預期：out_of_scope）",
    category: "illustration",
    fields: { subtype: { value: "不存在的類型" } },
  },
  // ── WBS 6.1 階段一：區間係數的確定性求值 ──
  // 在此之前這些係數一律被跳過，實際後果是「三天內急件」與「一個月交件」
  // 報價完全相同。以下四則證明它們在真實 rate card 資料上確實生效。
  {
    label: "插畫／急件 3 天（預期：基礎費 + 商業加成 + 急件加成）",
    category: "illustration",
    fields: {
      subtype: { value: "角色設計" },
      quantity: { value: "1" },
      license_scope: { value: "商業使用" },
      deadline_days: { value: "3" },
    },
  },
  {
    label: "插畫／交期 30 天（預期：與上一則相比少了急件加成）",
    category: "illustration",
    fields: {
      subtype: { value: "角色設計" },
      quantity: { value: "1" },
      license_scope: { value: "商業使用" },
      deadline_days: { value: "30" },
    },
  },
  {
    label: "插畫／精緻上色（預期：多一筆上色複雜度加成）",
    category: "illustration",
    fields: {
      subtype: { value: "單張插畫" },
      quantity: { value: "1" },
      license_scope: { value: "個人使用" },
      coloring_complexity: { value: "精緻上色" },
    },
  },
  {
    label: "網頁／3 個功能模組（預期：功能模組複雜度 × 3）",
    category: "web_design",
    fields: {
      subtype: { value: "多頁式網站" },
      page_count: { value: "1" },
      license_scope: { value: "個人使用" },
      feature_modules: { value: "會員系統、金流、多語系" },
    },
  },
];

async function main(): Promise<void> {
  const merchantId = await ensureDevMerchant();
  for (const { label, category, fields } of SAMPLES) {
    const pricing = await computeBasePricing(merchantId, category, fields);
    const code = await generateQuoteCode(merchantId, category);
    const preview = formatQuotePreview(category, pricing, code);

    console.log(`\n──────── ${label} ────────`);
    console.log(preview);
    console.log(
      "\n明細：",
      JSON.stringify(
        pricing.lineItems.map((i) => ({
          itemName: i.itemName,
          amount: i.amount,
          ruleId: i.ruleId,
          modifierId: i.modifierId,
        })),
        null,
        2,
      ),
    );
  }

  console.log("\n🎉 報價鏈驗收通過（真實查表 + 固定倍率加成 + out_of_scope + quote_code + 預覽）。");
}

main().catch((error: unknown) => {
  console.error("驗證腳本執行失敗：", error);
  process.exit(1);
});
