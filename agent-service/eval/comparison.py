"""標註 vs 抽取的比對（純函式）。

移植自 TypeScript 的 `src/domains/eval/comparison.ts`。與 runner 分開，
讓比對規則可以獨立於 Gemini 與資料庫被驗證。
"""

from pydantic import BaseModel

from app.agent.fields import FieldExtraction
from eval.normalization import normalize_field_value

# 標註值不帶 confidence，但下游計價的形狀需要一個。給 1.0 代表「標註即事實」，
# 不會被缺漏門檻擋掉。
ANNOTATION_CONFIDENCE = 1.0


class FieldComparison(BaseModel):
    """單一欄位的標註 vs 抽取結果（值皆為正規化後的形式）。"""

    name: str
    expected: str | None
    actual: str | None
    correct: bool


def compare_fields(
    expected_fields: dict[str, str | None],
    actual_fields: dict[str, FieldExtraction],
) -> list[FieldComparison]:
    """逐欄比對（兩側都先正規化）。

    以標註的欄位集合為準：模型少回的欄位會以 None 參與比對並被記為錯誤，
    多回的欄位不存在（record_fields 的白名單已擋掉自創欄位）。
    """
    comparisons: list[FieldComparison] = []
    for name, expected_raw in expected_fields.items():
        expected = normalize_field_value(name, expected_raw)
        stored = actual_fields.get(name)
        actual = normalize_field_value(name, stored.value if stored else None)
        comparisons.append(
            FieldComparison(name=name, expected=expected, actual=actual, correct=expected == actual)
        )
    return comparisons


def to_pricing_fields(expected_fields: dict[str, str | None]) -> dict[str, FieldExtraction]:
    """把標註欄位轉成計價輸入，用來算「抽取完全正確時應有的報價」。

    刻意傳入**未正規化**的標註原值：計價 API 內部有自己的正規化，
    此處若先正規化一次，量到的就不是計價的真實行為。
    """
    return {
        name: FieldExtraction(value=value, confidence=ANNOTATION_CONFIDENCE)
        for name, value in expected_fields.items()
    }
