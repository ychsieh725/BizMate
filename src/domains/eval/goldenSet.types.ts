import { z } from "zod";
import type { CaseCategory } from "@/shared/types/domain.types";
import { CASE_CATEGORIES } from "@/shared/constants/categories.ts";

/**
 * Golden Set 標註案例的型別與 schema（WBS 7.1）。
 *
 * 這份資料集是 Eval Runner（7.2）與 CI 品質閘門（8.5）的唯一事實來源：
 * 對每則客戶描述，人工標註「Parser 應該抽到什麼」與「哪些欄位應判為缺漏」。
 *
 * ── 為何 expected 不標 confidence ──
 * 人無法可靠標註「LLM 對這個值該有多少把握」。故只標兩件客觀可查證的事：
 * (1) 原文寫了什麼值 (2) 哪些必要欄位原文根本沒提。
 * confidence 由指標間接檢驗——原文沒提卻抽出值即為幻覺。
 */

/**
 * 資料集版本，對應 eval_runs.dataset_version。
 * 案例內容有實質變動（新增/刪除/改標註）時遞增，讓跨版本的指標比較有意義。
 */
export const DATASET_VERSION = "v1.0.0";

/**
 * ── 標註正規化約定（7.2 比對邏輯必須遵守）──
 *
 * LLM 對同一語意會有多種措辭（「true」/「需要」/「要提案」），字面全等比對會把
 * 語意正確的抽取誤判為錯誤。故標註端先固定為正規形式，由 Eval Runner 對 LLM
 * 輸出做同樣正規化後再比對：
 *
 * | 欄位型態 | 正規形式 | 範例 |
 * | :--- | :--- | :--- |
 * | 布林（includes_*） | `"是"` / `"否"` | includes_rwd: "是" |
 * | 數值（deadline_days, quantity, page_count） | 純數字字串 | "3"、"10" |
 * | 授權（license_scope） | 個人使用 / 商業使用 / 獨家買斷 | "商業使用" |
 * | 上色（coloring_complexity） | 精緻上色 / 簡易上色 / 線稿 | "精緻上色" |
 * | 子類型（subtype） | rate card 的標準名稱 | "LOGO設計" |
 * | 列舉多值（feature_modules） | 「、」分隔；明確表示不需要則為 `"無"` | "會員系統、金流" |
 *
 * 關鍵區別：`"無"` 是「原文明說不需要」（有抽到值），`null` 是「原文完全沒提」
 * （應判缺漏並觸發反問）。兩者對反問行為的期待完全相反，不可混用。
 */

/**
 * 單則案例的預期抽取結果。
 * fields 的鍵必須恰好等於 requiredFieldsFor(category)——多一個少一個都是標註錯誤，
 * 由 goldenSet.test.ts 強制。value 為 null 代表「原文未提及，Parser 應抽不到」。
 */
export const expectedExtractionSchema = z.object({
  fields: z.record(z.string(), z.string().nullable()),
  missingRequiredFields: z.array(z.string()),
});

export type ExpectedExtraction = z.infer<typeof expectedExtractionSchema>;

/** 單則標註案例。 */
export const goldenCaseSchema = z.object({
  /** 穩定識別碼（如 illu-001），跨版本不變，供指標按案例追蹤退步。 */
  id: z.string().min(1),
  category: z.enum(CASE_CATEGORIES as readonly [CaseCategory, ...CaseCategory[]]),
  /** 客戶的口語需求描述，即 Parser 的輸入。 */
  rawText: z.string().min(1),
  expected: expectedExtractionSchema,
  /** 這則案例意圖測什麼（供人閱讀與覆核，不參與指標計算）。 */
  notes: z.string().min(1),
});

export type GoldenCase = z.infer<typeof goldenCaseSchema>;
