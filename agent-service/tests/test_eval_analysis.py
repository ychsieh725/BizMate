"""統計層。

用文獻上的標準參考值驗證，而不是拿自己的實作當答案——統計公式抄錯不會拋錯，
只會安靜地給出偏移的數字，而那些數字接下來會被寫進報告與履歷。
"""

import pytest

from eval.analysis import (
    mcnemar_exact,
    observed_power_note,
    required_sample_size,
    wilson_interval,
)


class TestWilsonInterval:
    def test_matches_reference_value(self):
        """15/20 的 Wilson 95% 區間，標準參考值為 [0.531, 0.888]。"""
        estimate = wilson_interval(15, 20)

        assert estimate.point == 0.75
        assert estimate.lower == pytest.approx(0.531, abs=0.001)
        assert estimate.upper == pytest.approx(0.888, abs=0.001)

    def test_zero_successes_still_gives_an_upper_bound(self):
        """幻覺率為 0% 時，常態近似會退化成 [0, 0]——那會被誤讀成「確定不會有幻覺」。"""
        estimate = wilson_interval(0, 36)

        assert estimate.point == 0.0
        assert estimate.lower == 0.0
        assert estimate.upper > 0.0

    def test_perfect_score_upper_bound_is_capped_at_one(self):
        estimate = wilson_interval(36, 36)

        assert estimate.upper == 1.0
        assert estimate.lower < 1.0

    def test_zero_trials_is_unmeasurable(self):
        estimate = wilson_interval(0, 0)

        assert estimate.point is None
        assert estimate.format() == "n/a"

    def test_rejects_impossible_counts(self):
        with pytest.raises(ValueError):
            wilson_interval(5, 3)

    def test_format_is_report_ready(self):
        assert wilson_interval(15, 20).format() == "75.0% [53.1%, 88.8%]"


class TestMcNemarExact:
    def test_matches_reference_value(self):
        """b=1, c=9：雙尾精確 p = 2 × (C(10,0)+C(10,1)) / 2^10 = 0.021484。"""
        result = mcnemar_exact(1, 9)

        assert result.p_value == pytest.approx(0.021484, abs=1e-6)
        assert result.is_significant() is True

    def test_no_discordant_pairs_means_no_evidence(self):
        """兩側表現完全一致時，p 必須是 1——不是 0，也不是無法計算。"""
        result = mcnemar_exact(0, 0)

        assert result.p_value == 1.0
        assert result.discordant == 0
        assert result.is_significant() is False

    def test_symmetric_disagreement_is_not_significant(self):
        result = mcnemar_exact(5, 5)

        assert result.p_value == 1.0
        assert result.is_significant() is False

    def test_small_samples_lack_power(self):
        """b=0, c=3：改動側全贏，但 3 對樣本撐不起顯著性（p = 0.25）。"""
        result = mcnemar_exact(0, 3)

        assert result.p_value == pytest.approx(0.25)
        assert result.is_significant() is False

    def test_rejects_negative_counts(self):
        with pytest.raises(ValueError):
            mcnemar_exact(-1, 3)


class TestRequiredSampleSize:
    def test_matches_reference_value(self):
        """50% → 60%、α=0.05、power=0.80 的教科書答案是每組 388 則。"""
        assert required_sample_size(0.5, 0.1) == 388

    def test_accepts_negative_effect(self):
        """97.5% 之上沒有 5pp 的空間，能問的是「掉 5pp 察覺得到嗎」。"""
        assert required_sample_size(0.975, -0.05) > 0

    def test_smaller_effects_need_more_samples(self):
        assert required_sample_size(0.5, 0.05) > required_sample_size(0.5, 0.1)

    def test_rejects_zero_effect(self):
        with pytest.raises(ValueError):
            required_sample_size(0.5, 0)

    def test_rejects_out_of_range_result(self):
        with pytest.raises(ValueError):
            required_sample_size(0.98, 0.05)


class TestObservedPowerNote:
    def test_reports_insufficient_power_for_the_current_dataset(self):
        """36 則撐不起 5pp 的差異宣稱——報告要講出來，而不是讓人默默誤讀。"""
        note = observed_power_note(36, 0.975, -0.05)

        assert "不足" in note
        assert "36 則" in note

    def test_reports_sufficient_power_for_a_large_dataset(self):
        note = observed_power_note(5000, 0.975, -0.05)

        assert "足夠" in note
