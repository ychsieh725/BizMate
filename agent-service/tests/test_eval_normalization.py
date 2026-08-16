"""比對正規化。

移植自 TypeScript 的 normalization.test.ts。兩邊行為必須相同——A6 要比較兩個
runner 的指標，正規化規則不同的話量到的是比對規則差異。
"""

import pytest

from app.agent.fields import FieldExtraction
from eval.comparison import compare_fields, to_pricing_fields
from eval.normalization import normalize_field_value, normalize_license_scope


class TestLicenseScope:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("商用", "商業使用"),
            ("商業用途", "商業使用"),
            ("商業使用", "商業使用"),
            ("個人自用", "個人使用"),
            ("版權買斷", "獨家買斷"),
            ("獨家授權", "獨家買斷"),
        ],
    )
    def test_maps_variants_to_rate_card_domain(self, raw, expected):
        """以包含關係判斷：抽取值多變，但下游計價只認值域內的三個值。"""
        assert normalize_license_scope(raw) == expected

    def test_unrecognized_becomes_none(self):
        assert normalize_license_scope("不確定") is None


class TestBooleanFields:
    @pytest.mark.parametrize("raw", ["是", "true", "需要", "yes", "1"])
    def test_affirmative_synonyms(self, raw):
        assert normalize_field_value("includes_rwd", raw) == "是"

    @pytest.mark.parametrize("raw", ["否", "false", "不需要", "no", "0"])
    def test_negative_synonyms(self, raw):
        assert normalize_field_value("includes_cms", raw) == "否"

    def test_only_applies_to_includes_prefix(self):
        """對全欄位套用布林正規化會把 quantity 的 "1" 轉成「是」，錯記為抽錯。"""
        assert normalize_field_value("quantity", "1") == "1"


class TestQuantityFields:
    @pytest.mark.parametrize(("raw", "expected"), [("3", "3"), ("10", "10")])
    def test_positive_integers_pass_through(self, raw, expected):
        assert normalize_field_value("quantity", raw) == expected

    @pytest.mark.parametrize("raw", ["一批", "0", "-2"])
    def test_non_positive_integers_fall_back_to_one(self, raw):
        """對齊 parseQuantity：保守回退 1，不放大金額。"""
        assert normalize_field_value("page_count", raw) == "1"


class TestDeadlineDays:
    def test_extracts_digits(self):
        assert normalize_field_value("deadline_days", "14天") == "14"

    def test_keeps_text_when_no_digits(self):
        assert normalize_field_value("deadline_days", "越快越好") == "越快越好"


class TestUnnormalizedFields:
    def test_subtype_is_compared_literally(self):
        """rate card 用精確相等查表，抽到「LOGO」而非「LOGO設計」就查無資料。"""
        assert normalize_field_value("subtype", "LOGO") == "LOGO"

    def test_feature_modules_keeps_the_none_distinction(self):
        """「無」是明說不需要，None 是完全沒提——兩者對反問的期待相反。"""
        assert normalize_field_value("feature_modules", "無") == "無"
        assert normalize_field_value("feature_modules", None) is None


class TestEmptyValues:
    @pytest.mark.parametrize("raw", [None, "", "   "])
    def test_blank_becomes_none(self, raw):
        assert normalize_field_value("subtype", raw) is None


class TestCompareFields:
    def test_normalizes_both_sides_before_comparing(self):
        result = compare_fields(
            {"license_scope": "商業使用"},
            {"license_scope": FieldExtraction(value="商用", confidence=0.9)},
        )

        assert result[0].correct is True

    def test_missing_extraction_counts_as_wrong(self):
        result = compare_fields({"subtype": "LOGO設計"}, {})

        assert result[0].actual is None
        assert result[0].correct is False

    def test_expected_null_and_actual_null_is_correct(self):
        """正確判斷「原文沒提」也是一種正確，不是無從評估。"""
        result = compare_fields({"deadline_days": None}, {})

        assert result[0].correct is True

    def test_annotation_set_defines_the_field_universe(self):
        """以標註的欄位集合為準；模型多寫的欄位不參與比對。"""
        result = compare_fields(
            {"subtype": "LOGO設計"},
            {
                "subtype": FieldExtraction(value="LOGO設計", confidence=0.9),
                "quantity": FieldExtraction(value="3", confidence=0.9),
            },
        )

        assert [item.name for item in result] == ["subtype"]


class TestToPricingFields:
    def test_passes_raw_annotation_values(self):
        """刻意不先正規化：計價 API 內部有自己的正規化，先做一次就量不到真實行為。"""
        fields = to_pricing_fields({"license_scope": "商業使用"})

        assert fields["license_scope"].value == "商業使用"

    def test_annotation_is_never_treated_as_missing(self):
        fields = to_pricing_fields({"subtype": "LOGO設計"})

        assert fields["subtype"].confidence == 1.0
