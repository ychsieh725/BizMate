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
import type {
  TablesInsert,
} from "@/lib/supabase/database.types.ts";

// ── rate_card_base：各案件類型的子類型與基礎單價（附錄 A.2–A.4）──
const BASE_ROWS: TablesInsert<"rate_card_base">[] = [
  // 平面設計
  { category: "graphic_design", subtype: "LOGO設計", unit: "每款", base_price: 8000 },
  { category: "graphic_design", subtype: "海報文宣", unit: "每張", base_price: 5000 },
  { category: "graphic_design", subtype: "品牌識別CI-VI", unit: "每套", base_price: 30000 },
  { category: "graphic_design", subtype: "社群圖像", unit: "每張", base_price: 1500 },
  { category: "graphic_design", subtype: "名片文具", unit: "每組", base_price: 3000 },
  // 插畫
  { category: "illustration", subtype: "角色設計", unit: "每角色", base_price: 6000 },
  { category: "illustration", subtype: "單張插畫", unit: "每張", base_price: 4000 },
  { category: "illustration", subtype: "系列插畫", unit: "每張", base_price: 3500 },
  { category: "illustration", subtype: "貼圖表情包", unit: "每組", base_price: 12000 },
  // 網頁設計
  { category: "web_design", subtype: "Landing Page", unit: "每頁", base_price: 15000 },
  { category: "web_design", subtype: "多頁式網站", unit: "每頁", base_price: 8000 },
  { category: "web_design", subtype: "電商網站", unit: "整案", base_price: 80000 },
  { category: "web_design", subtype: "UI-UX設計稿", unit: "每頁面", base_price: 5000 },
];

// ── rate_card_modifiers：加成係數（附錄 A.1 共用 + A.2–A.4 各類型）──
// range 為倍率（0.30 = +30%）。deterministic 項目 min=max（固定倍率）；
// Pricing Agent 可判斷的項目給區間（第 6.3 章 bounded autonomy 的邊界來源）。
const MODIFIER_ROWS: TablesInsert<"rate_card_modifiers">[] = [
  // A.1 跨類型共用（category = null）
  { category: null, modifier_name: "商業使用加成", trigger_condition: "授權範圍=商業使用", range_min: 0.3, range_max: 0.3 },
  { category: null, modifier_name: "獨家買斷加成", trigger_condition: "授權範圍=獨家買斷", range_min: 1.0, range_max: 1.0 },
  { category: null, modifier_name: "急件加成", trigger_condition: "交期<=急件門檻(3天)", range_min: 0.2, range_max: 0.5 },
  // A.2 平面設計
  { category: "graphic_design", modifier_name: "印刷檔輸出", trigger_condition: "需CMYK/出血/向量印刷檔", range_min: 0.15, range_max: 0.3 },
  { category: "graphic_design", modifier_name: "品牌規範完整度", trigger_condition: "需完整VI系統文件而非僅LOGO", range_min: 0.2, range_max: 0.5 },
  // A.3 插畫
  { category: "illustration", modifier_name: "上色複雜度加成", trigger_condition: "精緻上色vs簡易上色/線稿", range_min: 0.2, range_max: 0.6 },
  { category: "illustration", modifier_name: "高解析度輸出", trigger_condition: "需高解析度原檔/印刷輸出", range_min: 0.1, range_max: 0.25 },
  // A.4 網頁設計
  { category: "web_design", modifier_name: "功能模組複雜度", trigger_condition: "每加一個模組(會員/金流/多語系)", range_min: 0.15, range_max: 0.4 },
];

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
