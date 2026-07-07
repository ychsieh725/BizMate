/**
 * Rate Card 範本資料（純資料模組，無副作用）。
 *
 * 數字為 **建議預設值（幣別 TWD）**，依 PRD 附錄 A 建立完整定價結構。
 * 多租戶重構後灌入 rate_card_template_* 全域範本表；新商家 onboarding 時
 * 整份複製到自己名下，之後在後台自行調整（改表即生效）。
 */
import type { TablesInsert } from "@/lib/supabase/database.types.ts";

// ── rate_card_template_base：各案件類型的子類型與基礎單價（附錄 A.2–A.4）──
// includes 為該基礎價的基本服務內容（自然語言，供報價單顯示與 Agent 判斷內含範圍）。
export const BASE_ROWS: TablesInsert<"rate_card_template_base">[] = [
  // 平面設計
  { category: "graphic_design", subtype: "LOGO設計", unit: "每款", base_price: 8000, includes: "2款初稿提案、2次修改、交付JPG/PNG成品檔" },
  { category: "graphic_design", subtype: "海報文宣", unit: "每張", base_price: 5000, includes: "1款版面設計、2次修改、交付印刷用JPG/PDF" },
  { category: "graphic_design", subtype: "品牌識別CI-VI", unit: "每套", base_price: 30000, includes: "LOGO設計、標準色與字型規範、基礎應用範例、VI手冊PDF" },
  { category: "graphic_design", subtype: "社群圖像", unit: "每張", base_price: 1500, includes: "1款版面設計、1次修改、交付社群平台適用尺寸JPG/PNG" },
  { category: "graphic_design", subtype: "名片文具", unit: "每組", base_price: 3000, includes: "雙面名片設計、1次修改、交付印刷用CMYK檔" },
  // 插畫
  { category: "illustration", subtype: "角色設計", unit: "每角色", base_price: 6000, includes: "1個角色三視圖、2次修改、交付去背PNG原檔" },
  { category: "illustration", subtype: "單張插畫", unit: "每張", base_price: 4000, includes: "1張完稿插畫、2次修改、交付JPG/PNG成品檔" },
  { category: "illustration", subtype: "系列插畫", unit: "每張", base_price: 3500, includes: "風格一致之系列插畫（單張計）、每張1次修改、交付JPG/PNG" },
  { category: "illustration", subtype: "貼圖表情包", unit: "每組", base_price: 12000, includes: "8款貼圖設計、2次修改、交付上架規格PNG" },
  // 網頁設計
  { category: "web_design", subtype: "Landing Page", unit: "每頁", base_price: 15000, includes: "單頁RWD設計稿、2次修改、交付Figma設計檔" },
  { category: "web_design", subtype: "多頁式網站", unit: "每頁", base_price: 8000, includes: "單頁RWD設計稿（多頁以頁計）、每頁2次修改、交付Figma設計檔" },
  { category: "web_design", subtype: "電商網站", unit: "整案", base_price: 80000, includes: "首頁、商品列表、商品內頁、購物車與結帳流程設計稿、交付Figma設計檔" },
  { category: "web_design", subtype: "UI-UX設計稿", unit: "每頁面", base_price: 5000, includes: "單一頁面UI設計、2次修改、交付Figma設計檔" },
];

// ── rate_card_template_modifiers：加成係數（附錄 A.1 共用 + A.2–A.4 各類型）──
// range 為倍率（0.30 = +30%）。deterministic 項目 min=max（固定倍率）；
// Pricing Agent 可判斷的項目給區間（第 6.3 章 bounded autonomy 的邊界來源）。
export const MODIFIER_ROWS: TablesInsert<"rate_card_template_modifiers">[] = [
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
