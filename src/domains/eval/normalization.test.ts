import { describe, it, expect } from "vitest";
import { normalizeFieldValue } from "./normalization.ts";

/**
 * 抽取值的比對正規化（WBS 7.2，從 7.1 的 verify script 提煉）。
 *
 * 核心原則：衡量的是「抽取結果餵給 pricing 後會不會算錯」，不是「字串長得像不像」。
 * 故正規化必須對齊下游的真實邏輯——否則下游算對的案例會被記為錯誤（假警報），
 * 而假警報會誤導修復方向，並讓 CI 閘門建立在錯誤的基準上。
 */

describe("normalizeFieldValue — 空值處理", () => {
  it("null 與空白字串一律視為未抽到", () => {
    expect(normalizeFieldValue("subtype", null)).toBeNull();
    expect(normalizeFieldValue("subtype", "")).toBeNull();
    expect(normalizeFieldValue("subtype", "   ")).toBeNull();
  });
});

describe("normalizeFieldValue — license_scope 對齊 basePricing", () => {
  it("多種措辭映射到同一授權維度（下游 normalizeLicenseScope 的行為）", () => {
    expect(normalizeFieldValue("license_scope", "商業使用")).toBe("商業使用");
    expect(normalizeFieldValue("license_scope", "商業用途")).toBe("商業使用");
    expect(normalizeFieldValue("license_scope", "商用")).toBe("商業使用");
    expect(normalizeFieldValue("license_scope", "個人自用")).toBe("個人使用");
    expect(normalizeFieldValue("license_scope", "買斷")).toBe("獨家買斷");
  });

  it("無法歸類的授權說法回 null（與下游一致）", () => {
    expect(normalizeFieldValue("license_scope", "不確定")).toBeNull();
  });
});

describe("normalizeFieldValue — 數量欄位對齊 parseQuantity", () => {
  it("非正整數回退為 1（下游 parseQuantity 的保守回退）", () => {
    expect(normalizeFieldValue("quantity", "一組")).toBe("1");
    expect(normalizeFieldValue("page_count", "一頁式")).toBe("1");
    expect(normalizeFieldValue("quantity", "0")).toBe("1");
    expect(normalizeFieldValue("quantity", "-3")).toBe("1");
  });

  it("正整數保留原值", () => {
    expect(normalizeFieldValue("quantity", "5")).toBe("5");
    expect(normalizeFieldValue("page_count", "20")).toBe("20");
  });

  it("數量欄位不受布林正規化污染（'1' 不可變成「是」）", () => {
    expect(normalizeFieldValue("quantity", "1")).toBe("1");
  });
});

describe("normalizeFieldValue — 布林欄位", () => {
  it("includes_* 的肯定與否定措辭收斂為是/否", () => {
    expect(normalizeFieldValue("includes_rwd", "是")).toBe("是");
    expect(normalizeFieldValue("includes_rwd", "true")).toBe("是");
    expect(normalizeFieldValue("includes_cms", "需要")).toBe("是");
    expect(normalizeFieldValue("includes_cms", "否")).toBe("否");
    expect(normalizeFieldValue("includes_pitch_rounds", "false")).toBe("否");
    expect(normalizeFieldValue("includes_pitch_rounds", "不需要")).toBe("否");
  });
});

describe("normalizeFieldValue — 交期", () => {
  it("帶單位的天數取數字部分", () => {
    expect(normalizeFieldValue("deadline_days", "14天")).toBe("14");
    expect(normalizeFieldValue("deadline_days", "14")).toBe("14");
  });

  it("中文數字無法換算時保留原值（讓差異現形，不假裝算對）", () => {
    expect(normalizeFieldValue("deadline_days", "二十天")).toBe("二十天");
  });
});

describe("normalizeFieldValue — 刻意不正規化的欄位", () => {
  it("subtype 維持原值：下游用精確相等查表，差一個字就查無", () => {
    expect(normalizeFieldValue("subtype", "LOGO")).toBe("LOGO");
    expect(normalizeFieldValue("subtype", "LOGO設計")).toBe("LOGO設計");
  });

  it("feature_modules 維持原值：「無」與 null 對反問的期待相反，不可混同", () => {
    expect(normalizeFieldValue("feature_modules", "無")).toBe("無");
    expect(normalizeFieldValue("feature_modules", "金流、會員系統")).toBe(
      "金流、會員系統",
    );
  });
});
