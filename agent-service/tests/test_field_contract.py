"""欄位契約：Python 端與 TypeScript 端必須逐項相符。

A6 會在同一份 golden set 上比較 agent 與單步 baseline。欄位清單、值域或
confidence 門檻有任何一項不同，量到的就是設定差異而非能力差異，整個對照作廢。

契約檔由 `pnpm export:contracts` 從 TypeScript 的事實來源產生。改了 TS 卻沒
同步 Python，這裡就會紅——A3 移植時 coloring_complexity 被抄成
「線稿/平塗/厚塗」（實際是「精緻上色/簡易上色/線稿」）而無人察覺，
正是缺了這道檢查。
"""

import json
from pathlib import Path

import pytest

from app.agent import fields

CONTRACT_PATH = (
    Path(__file__).resolve().parent.parent / "eval" / "contracts" / "field_contract.json"
)


@pytest.fixture(scope="module")
def contract() -> dict[str, object]:
    return json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))


def test_contract_file_exists():
    assert CONTRACT_PATH.is_file(), f"缺少契約檔，請執行 pnpm export:contracts（{CONTRACT_PATH}）"


def test_confidence_threshold_matches(contract):
    assert fields.CONFIDENCE_THRESHOLD == contract["confidence_threshold"]


def test_common_required_fields_match(contract):
    assert list(fields.COMMON_REQUIRED_FIELDS) == contract["common_required_fields"]


def test_category_specific_fields_match(contract):
    expected = contract["category_specific_fields"]
    actual = {name: list(values) for name, values in fields.CATEGORY_SPECIFIC_FIELDS.items()}
    assert actual == expected


def test_boolean_domain_matches(contract):
    assert list(fields.BOOLEAN_DOMAIN) == contract["boolean_domain"]


def test_boolean_field_prefix_matches(contract):
    assert fields.BOOLEAN_FIELD_PREFIX == contract["boolean_field_prefix"]


def test_static_field_domains_match(contract):
    expected = contract["static_field_domains"]
    actual = {name: list(values) for name, values in fields.STATIC_FIELD_DOMAINS.items()}
    assert actual == expected


def test_case_categories_cover_contract(contract):
    """Literal CaseCategory 無法從 JSON 產生，故單獨確認涵蓋範圍一致。"""
    assert set(fields.CATEGORY_SPECIFIC_FIELDS) == set(contract["category_specific_fields"])
    assert set(fields.CASE_CATEGORY_LABELS) == set(contract["category_specific_fields"])
