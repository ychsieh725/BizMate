"""必要欄位定義與缺漏判定。

由 TypeScript 端 src/domains/intake/parserFields.ts 移植。**兩邊必須一致**——
A6 會在同一份 golden set 上比較 agent 與單步 baseline，欄位清單或門檻不同就
沒有可比性，量到的差異會是設定差異而非能力差異。

這一層是不變式 I-2 的所在：「哪些欄位還缺」由 confidence 門檻 deterministic
算出，不交給 LLM 宣稱。
"""

from typing import Literal

from pydantic import BaseModel, Field

CaseCategory = Literal["graphic_design", "illustration", "web_design"]

CASE_CATEGORY_LABELS: dict[CaseCategory, str] = {
    "graphic_design": "平面設計",
    "illustration": "插畫",
    "web_design": "網頁設計",
}

# 跨案件類型共用的必要欄位（PRD 附錄 A.1：授權、交期）。
COMMON_REQUIRED_FIELDS: tuple[str, ...] = ("license_scope", "deadline_days")

# 各案件類型專屬的必要欄位（PRD 附錄 A.2–A.4）。
CATEGORY_SPECIFIC_FIELDS: dict[CaseCategory, tuple[str, ...]] = {
    "graphic_design": ("subtype", "quantity", "includes_pitch_rounds"),
    "illustration": ("subtype", "quantity", "coloring_complexity"),
    "web_design": (
        "subtype",
        "page_count",
        "feature_modules",
        "includes_rwd",
        "includes_cms",
    ),
}

# confidence 門檻：低於此值視為抽取不可靠，等同缺漏、觸發反問。
CONFIDENCE_THRESHOLD = 0.6

# 值域固定、與商家無關的欄位。subtype 不在此表——它的值域是 per-merchant 的
# rate card，由 lookup_rate_card 查得後傳入。
LICENSE_SCOPE_DOMAIN: tuple[str, ...] = ("個人", "商業", "獨家買斷", "有限期限")
COLORING_COMPLEXITY_DOMAIN: tuple[str, ...] = ("線稿", "平塗", "厚塗")
BOOLEAN_DOMAIN: tuple[str, ...] = ("是", "否")

STATIC_FIELD_DOMAINS: dict[str, tuple[str, ...]] = {
    "license_scope": LICENSE_SCOPE_DOMAIN,
    "coloring_complexity": COLORING_COMPLEXITY_DOMAIN,
}

# `includes_` 開頭一律視為布林欄位。用前綴規則而非逐一列舉，讓日後新增同類
# 欄位自動獲得值域約束——漏掉值域會靜默退回自由字串，是不易察覺的退步。
BOOLEAN_FIELD_PREFIX = "includes_"

# 反問排序：影響金額大的排前面（FR-CL-1）。
# subtype 決定基礎費率查表、quantity/page_count 是數量乘數，故排在授權/交期之前。
CLARIFICATION_FIELD_PRIORITY: tuple[str, ...] = (
    "subtype",
    "quantity",
    "page_count",
    "license_scope",
    "deadline_days",
)


class FieldExtraction(BaseModel):
    """單一欄位的抽取結果。

    value 統一以字串（或 None）承載——抽取階段只取原文值，型別轉換留給下游
    pricing，避免抽取 schema 因欄位型別而爆炸（沿用 TS 端的既有決定）。
    """

    value: str | None = None
    confidence: float = Field(ge=0, le=1)
    source_span: str | None = None


def required_fields_for(category: CaseCategory) -> list[str]:
    """某案件類型的完整必要欄位清單（專屬 + 共用）。"""
    return [*CATEGORY_SPECIFIC_FIELDS[category], *COMMON_REQUIRED_FIELDS]


def domain_for(
    field_name: str, allowed_subtypes: list[str] | None = None
) -> tuple[str, ...] | None:
    """取某欄位的合法值域；無固定值域回 None（表示自由字串）。

    新商家尚無 active 服務項目時清單為空。空值域會讓模型無值可選而必定失敗，
    故降級為自由字串——此時 rate card 本就查不到，會照既有路徑走 out_of_scope。
    """
    if field_name == "subtype":
        return tuple(allowed_subtypes) if allowed_subtypes else None
    if field_name.startswith(BOOLEAN_FIELD_PREFIX):
        return BOOLEAN_DOMAIN
    return STATIC_FIELD_DOMAINS.get(field_name)


def is_field_missing(field: FieldExtraction | None) -> bool:
    """判斷單一欄位是否缺漏：不存在、值為空、或 confidence 低於門檻。

    **不變式 I-2 的核心。** agent 得知「還缺什麼」的唯一管道是這個函式的結果，
    它無法自行宣稱欄位已齊全。
    """
    if field is None:
        return True
    if field.value is None or field.value.strip() == "":
        return True
    return field.confidence < CONFIDENCE_THRESHOLD


def find_missing_fields(category: CaseCategory, fields: dict[str, FieldExtraction]) -> list[str]:
    """算出該案件類型還缺哪些必要欄位。"""
    return [name for name in required_fields_for(category) if is_field_missing(fields.get(name))]


def order_missing_fields(missing_fields: list[str]) -> list[str]:
    """將缺漏欄位依「影響金額」優先序排列。

    先放優先序清單命中的（依清單序），再放未涵蓋的欄位（依原序穩定殿後）。
    """
    prioritized = [f for f in CLARIFICATION_FIELD_PRIORITY if f in missing_fields]
    rest = [f for f in missing_fields if f not in CLARIFICATION_FIELD_PRIORITY]
    return [*prioritized, *rest]
