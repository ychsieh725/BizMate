"""抽取值的比對正規化。

移植自 TypeScript 的 `src/domains/eval/normalization.ts`，**行為必須完全相同**
——A6 要比較兩個 runner 的指標，正規化規則不同的話，量到的差異是比對規則差異。

原始設計的理由（沿用，不重寫）：衡量的對象是「抽取結果餵給 pricing 後會不會
算錯」，不是「字串長得像不像」。basePricing 對 license_scope 做包含式正規化、
對數量做 parseInt + 回退 1，此處沿用同一套邏輯——否則「商業用途」vs「商業使用」
會被記為錯誤，但下游其實算得完全正確，指標就成了假警報。

刻意「不」正規化的兩個欄位，因為下游真的會出錯，必須讓它現形：
  - subtype：rate card 用精確相等查表，抽到「LOGO」而非「LOGO設計」就查無資料
  - feature_modules：「明說不需要（無）」與「完全沒提（None）」對反問行為的
    期待相反，混為一談會讓客戶被問已回答過的問題
"""

import re

# 布林欄位的肯定／否定同義詞（與 TS 端同一份清單）。
AFFIRMATIVE = ("是", "true", "有", "要", "需要", "yes", "y", "1")
NEGATIVE = ("否", "false", "沒有", "不要", "不需要", "no", "n", "none", "0")

# 走 basePricing.parseQuantity 同一套回退邏輯的數量欄位。
QUANTITY_FIELDS = frozenset({"quantity", "page_count"})

BOOLEAN_FIELD_PREFIX = "includes_"

_DIGITS = re.compile(r"\d+")


def normalize_license_scope(value: str | None) -> str | None:
    """授權範圍正規化到 rate card 的值域。

    以包含關係判斷而非精確相等——抽取值多變（「商用」「商業用途」「個人自用」）。
    判斷不出回 None。移植自 `src/domains/pricing/licenseScope.ts`。
    """
    if value is None:
        return None
    if "獨家" in value or "買斷" in value:
        return "獨家買斷"
    if "商業" in value or "商用" in value:
        return "商業使用"
    if "個人" in value:
        return "個人使用"
    return None


def normalize_field_value(field_name: str, raw: str | None) -> str | None:
    """把單一欄位值壓到可比對的正規形式；None 代表「未抽到值」。"""
    if raw is None:
        return None
    trimmed = raw.strip()
    if trimmed == "":
        return None

    if field_name == "license_scope":
        return normalize_license_scope(trimmed)

    # 布林正規化只套用在 includes_* 欄位——對全欄位套用的話，quantity 的 "1"
    # 會被當成肯定詞轉為「是」，把正確抽取記成錯誤。
    if field_name.startswith(BOOLEAN_FIELD_PREFIX):
        lowered = trimmed.lower()
        if lowered in AFFIRMATIVE:
            return "是"
        if lowered in NEGATIVE:
            return "否"
        return trimmed

    if field_name in QUANTITY_FIELDS:
        # 對齊 parseQuantity：非正整數一律回退 1（保守，不放大金額）
        try:
            parsed = int(trimmed)
        except ValueError:
            return "1"
        return str(parsed) if parsed > 0 else "1"

    if field_name == "deadline_days":
        found = _DIGITS.search(trimmed)
        return found.group(0) if found else trimmed

    return trimmed
