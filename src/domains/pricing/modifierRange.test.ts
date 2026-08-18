/**
 * 加成係數的區間驗證（WBS 6.2、FR-PR-2 AC）。
 *
 * SRS 的要求逐字是：「任何 agent 產出的加成金額換算為係數後必落在
 * [range_min, range_max] 內；系統應在**寫入前做程式層驗證（非僅依賴 prompt）**，
 * 超界即拒絕寫入並記錄。」
 *
 * 括號裡那句是重點，也是這個檔案存在的唯一理由。這一層先於任何 LLM 實作
 * 建立：鎖要在門打開之前裝好。
 *
 * 為何拒絕而非夾到邊界值：夾住會讓「模型持續給出界的值」變成看不見的常態，
 * 而那正是最需要知道的訊號。拒絕會讓它現形。
 */
import { describe, expect, it } from "vitest";

import { validateModifierRatio } from "./modifierRange.ts";

const RANGE = { rangeMin: 0.2, rangeMax: 0.5 };

describe("validateModifierRatio", () => {
  it("區間內接受", () => {
    expect(validateModifierRatio(0.35, RANGE)).toEqual({ ok: true, ratio: 0.35 });
  });

  it.each([
    ["下界", 0.2],
    ["上界", 0.5],
  ])("剛好等於%s視為合法（閉區間）", (_label, ratio) => {
    expect(validateModifierRatio(ratio, RANGE)).toEqual({ ok: true, ratio });
  });

  it("低於下界拒絕，並報出實際值與區間", () => {
    const result = validateModifierRatio(0.1, RANGE);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("0.1");
    expect(result.ok === false && result.reason).toContain("0.2");
    expect(result.ok === false && result.reason).toContain("0.5");
  });

  it("高於上界拒絕", () => {
    expect(validateModifierRatio(0.9, RANGE).ok).toBe(false);
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["負值", -0.3],
  ])("%s 拒絕", (_label, ratio) => {
    expect(validateModifierRatio(ratio, RANGE).ok).toBe(false);
  });

  it("區間未定義時拒絕 —— 沒有邊界就沒有 bounded autonomy", () => {
    expect(validateModifierRatio(0.3, { rangeMin: null, rangeMax: 0.5 }).ok).toBe(false);
    expect(validateModifierRatio(0.3, { rangeMin: 0.2, rangeMax: null }).ok).toBe(false);
  });

  it("區間反轉（min > max）拒絕 —— 那是資料錯誤，不該靜默接受任何值", () => {
    const result = validateModifierRatio(0.3, { rangeMin: 0.5, rangeMax: 0.2 });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("區間定義有誤");
  });

  it("固定倍率（min === max）只接受該值", () => {
    const fixed = { rangeMin: 0.3, rangeMax: 0.3 };

    expect(validateModifierRatio(0.3, fixed).ok).toBe(true);
    expect(validateModifierRatio(0.31, fixed).ok).toBe(false);
  });
});
