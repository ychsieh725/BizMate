"""Golden set 的載入與期望軌跡推導。

標註的唯一事實來源在 TypeScript（`src/domains/eval/goldenCases.*.ts`），
由 `pnpm export:contracts` 匯出成本目錄下的 cases.json。**不要在 Python 這側
新增或修改案例**——兩份標註遲早會漂移，A6 的對照就作廢了。
"""

import json
from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel, Field

from app.agent.fields import CaseCategory
from app.agent.tools.ask_customer import NAME as ASK_CUSTOMER
from app.agent.tools.compute_quote import NAME as COMPUTE_QUOTE
from app.agent.tools.lookup_rate_card import NAME as LOOKUP_RATE_CARD
from app.agent.tools.record_fields import NAME as RECORD_FIELDS

GOLDEN_SET_PATH = Path(__file__).resolve().parent / "golden_set" / "cases.json"


class ExpectedExtraction(BaseModel):
    """單則案例的標註答案。

    fields 的值為 None 代表「原文未提及，不該抽到值」——幻覺率就是在量這件事。
    """

    fields: dict[str, str | None]
    missing_required_fields: list[str]


class GoldenCase(BaseModel):
    id: str = Field(min_length=1)
    category: CaseCategory
    raw_text: str = Field(min_length=1)
    expected: ExpectedExtraction
    # 這則在測什麼。不參與指標計算，但報告要印得出來——只看 id 無從判斷退步的意義。
    notes: str = Field(min_length=1)


class GoldenSet(BaseModel):
    dataset_version: str
    cases: list[GoldenCase]


@lru_cache(maxsize=1)
def load_golden_set(path: Path = GOLDEN_SET_PATH) -> GoldenSet:
    """載入並驗證 golden set。

    pydantic 在此不只是解析：形狀不合（如缺 notes、category 不是三者之一）
    會當場失敗，而不是等到跑完 36 則 LLM 呼叫才發現標註壞了。
    """
    if not path.is_file():
        raise FileNotFoundError(f"找不到 golden set：{path}。請執行 pnpm export:contracts。")
    return GoldenSet.model_validate(json.loads(path.read_text(encoding="utf-8")))


def expected_tool_sequence(case: GoldenCase) -> tuple[str, ...]:
    """推導這則案例的期望 tool 序列。

    ── 為何用推導而非人工標註 ──
    設計文件原本規劃人工標註 36 則的期望軌跡。但期望序列**完全由既有標註決定**：
    系統指令要求先查值域、再記錄欄位，然後依「還缺不缺」二擇一收尾。
    手標等於把 missing_required_fields 抄成另一種形式，多養一份會漂移的資料，
    卻不帶來任何新資訊。

    這條規則本身就是被檢驗的對象：agent 若走出別的路徑（例如跳過
    lookup_rate_card 直接記錄），tool_sequence_match_rate 就會掉——那正是
    我們想知道的事。
    """
    terminal = ASK_CUSTOMER if case.expected.missing_required_fields else COMPUTE_QUOTE
    return (LOOKUP_RATE_CARD, RECORD_FIELDS, terminal)
