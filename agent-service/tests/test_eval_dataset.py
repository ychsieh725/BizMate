"""Golden set 的載入與期望軌跡推導。

標註本身的完整性在 TypeScript 端已有 goldenSet.test.ts 把關，這裡不重複。
此處守的是**Python 這側依賴的假設**：欄位鍵集合與 required_fields_for 一致
（指標的分母直接由它決定）、期望軌跡的推導規則正確。
"""

from app.agent.fields import required_fields_for
from eval.dataset import expected_tool_sequence, load_golden_set

EXPECTED_CASE_COUNT = 36


def test_loads_and_validates():
    golden_set = load_golden_set()

    assert golden_set.dataset_version
    assert len(golden_set.cases) == EXPECTED_CASE_COUNT


def test_case_ids_are_unique():
    ids = [case.id for case in load_golden_set().cases]

    assert len(set(ids)) == len(ids)


def test_fields_match_required_fields_for_category():
    """欄位鍵集合即指標的分母，多一個少一個都會讓準確率失真。"""
    for case in load_golden_set().cases:
        assert set(case.expected.fields) == set(required_fields_for(case.category)), case.id


def test_missing_fields_are_a_subset_of_required():
    for case in load_golden_set().cases:
        assert set(case.expected.missing_required_fields) <= set(case.expected.fields), case.id


def test_missing_fields_are_exactly_the_null_annotations():
    """標註為 None 的欄位就是該判缺漏的欄位。

    兩者若不一致，「幻覺率」與「反問召回率」會建立在互相矛盾的前提上。
    """
    for case in load_golden_set().cases:
        nulls = {name for name, value in case.expected.fields.items() if value is None}
        assert nulls == set(case.expected.missing_required_fields), case.id


class TestExpectedToolSequence:
    def test_incomplete_case_ends_with_ask_customer(self):
        case = next(c for c in load_golden_set().cases if c.expected.missing_required_fields)

        assert expected_tool_sequence(case) == (
            "lookup_rate_card",
            "record_fields",
            "ask_customer",
        )

    def test_complete_case_ends_with_compute_quote(self):
        case = next(c for c in load_golden_set().cases if not c.expected.missing_required_fields)

        assert expected_tool_sequence(case) == (
            "lookup_rate_card",
            "record_fields",
            "compute_quote",
        )

    def test_every_case_has_a_derivable_sequence(self):
        """推導取代人工標註的前提：每一則都推得出來，沒有需要人判斷的例外。"""
        for case in load_golden_set().cases:
            assert len(expected_tool_sequence(case)) == 3, case.id
