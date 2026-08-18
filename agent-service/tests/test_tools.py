"""四個 tool 的行為。

重點在三條不變式的機械化驗收：
- I-1：compute_quote 無參數，agent 無從影響金額
- I-2：still_missing 由程式端算出，agent 無法自稱齊全
- 邊界：record_fields 拒絕自創欄位與值域外的值；ask_customer 只能問缺漏欄位
"""

import pytest

from app.agent.fields import LICENSE_SCOPE_DOMAIN, FieldExtraction
from app.agent.tools.ask_customer import MAX_CLARIFICATION_ROUNDS, AskCustomerTool
from app.agent.tools.base import ToolContext
from app.agent.tools.compute_quote import ComputeQuoteTool
from app.agent.tools.lookup_rate_card import LookupRateCardTool
from app.agent.tools.record_fields import RecordFieldsTool
from app.db.repositories.rate_card import RateCardService
from app.pricing_client import PricingResult, PricingUnavailableError

SESSION_ID = "11111111-1111-4111-8111-111111111111"
MERCHANT_ID = "22222222-2222-4222-8222-222222222222"

SUBTYPES = ["品牌識別設計", "海報設計"]


def context(completed_rounds: int = 0) -> ToolContext:
    return ToolContext(
        session_id=SESSION_ID,
        merchant_id=MERCHANT_ID,
        category="graphic_design",
        completed_rounds=completed_rounds,
    )


def extraction(value: str | None, confidence: float = 0.9) -> FieldExtraction:
    return FieldExtraction(value=value, confidence=confidence, source_span=None)


class FakeRateCard:
    """假費率表。

    unit 一律用「每款」除非另行指定——絕大多數測試不在意單位，但它是
    RateCardService 的必要欄位；讓它有個合理預設，測試才不必為了無關的
    欄位而寫得冗長。
    """

    def __init__(
        self,
        subtypes: list[str] | None = None,
        units: dict[str, str] | None = None,
    ) -> None:
        self.subtypes = SUBTYPES if subtypes is None else subtypes
        self.units = units or {}

    async def find_active_services(self, merchant_id: str, category: str) -> list[RateCardService]:
        return [
            RateCardService(subtype=name, unit=self.units.get(name, "每款"))
            for name in self.subtypes
        ]


class FakeStorage:
    """記憶體版的 extracted_fields。"""

    def __init__(self, initial: dict[str, FieldExtraction] | None = None) -> None:
        self.fields: dict[str, FieldExtraction] = dict(initial or {})

    async def upsert_many(self, session_id: str, fields: dict[str, FieldExtraction]) -> None:
        self.fields.update(fields)

    async def find_by_session(self, session_id: str) -> dict[str, FieldExtraction]:
        return dict(self.fields)


class FakeTurns:
    def __init__(self) -> None:
        self.written: list[tuple[int, list[tuple[str, str]]]] = []

    async def create_many(
        self, session_id: str, round_number: int, items: list[tuple[str, str]]
    ) -> None:
        self.written.append((round_number, items))


# graphic_design 的完整必要欄位
COMPLETE_FIELDS = {
    "subtype": extraction("品牌識別設計"),
    "quantity": extraction("3"),
    "includes_pitch_rounds": extraction("是"),
    "license_scope": extraction("商業"),
    "deadline_days": extraction("14"),
}


class TestLookupRateCard:
    async def test_returns_active_subtypes(self):
        tool = LookupRateCardTool(repository=FakeRateCard())

        outcome = await tool.execute({}, context())

        assert outcome.result["subtypes"] == SUBTYPES

    async def test_returns_pricing_units(self):
        """計價單位必須跟著服務項目一起回去。

        A6 實測發現模型把「一組貼圖，八款」的數量抽成 8，而費率表是按組計價
        （一組內含 8 款），正確答案是 1，金額因此差 8 倍。根因不是 prompt 少寫
        規則，而是**計價單位從來沒有給模型**：這個 tool 原本只回 subtype 名稱。

        這條守住那個資訊通道。它斷掉不會有任何執行期錯誤，只會讓報價悄悄回到
        差好幾倍的狀態。
        """
        tool = LookupRateCardTool(
            repository=FakeRateCard(
                subtypes=["貼圖表情包", "單張插畫"],
                units={"貼圖表情包": "每組", "單張插畫": "每張"},
            )
        )

        outcome = await tool.execute({}, context())

        assert outcome.result["pricing_units"] == {
            "貼圖表情包": "每組",
            "單張插畫": "每張",
        }

    async def test_pricing_units_empty_when_no_active_services(self):
        tool = LookupRateCardTool(repository=FakeRateCard(subtypes=[]))

        outcome = await tool.execute({}, context())

        assert outcome.result["pricing_units"] == {}

    async def test_returns_field_domains(self):
        tool = LookupRateCardTool(repository=FakeRateCard())

        outcome = await tool.execute({}, context())

        options = outcome.result["field_options"]
        # 引用常數而非重打一份字面值：值域是否正確由 test_field_contract 對
        # TypeScript 的匯出檔把關，這裡只驗「有把值域交給模型」。
        # （原本這行寫死了錯誤的值域，反而讓 A3 的移植錯誤看起來是綠的。）
        assert options["license_scope"] == list(LICENSE_SCOPE_DOMAIN)
        assert options["subtype"] == SUBTYPES

    async def test_boolean_fields_get_domain_by_prefix(self):
        """includes_ 前綴自動獲得布林值域，不需逐一列舉。"""
        tool = LookupRateCardTool(repository=FakeRateCard())

        outcome = await tool.execute({}, context())

        assert outcome.result["field_options"]["includes_pitch_rounds"] == ["是", "否"]

    async def test_free_text_fields_have_no_domain(self):
        tool = LookupRateCardTool(repository=FakeRateCard())

        outcome = await tool.execute({}, context())

        assert outcome.result["field_options"]["quantity"] is None

    async def test_empty_rate_card_degrades_subtype_to_free_text(self):
        """新商家尚無服務項目時，空值域會讓模型無值可選而必定失敗。"""
        tool = LookupRateCardTool(repository=FakeRateCard(subtypes=[]))

        outcome = await tool.execute({}, context())

        assert outcome.result["field_options"]["subtype"] is None

    def test_declaration_takes_no_parameters(self):
        """商家與類別由 ToolContext 決定——模型能指定就等於能跨租戶查詢。"""
        tool = LookupRateCardTool()

        assert tool.declaration.parameters_json_schema["properties"] == {}


class TestRecordFields:
    async def test_accepts_valid_fields(self):
        storage = FakeStorage()
        tool = RecordFieldsTool(storage=storage, rate_card=FakeRateCard())

        outcome = await tool.execute(
            {"fields": {"subtype": {"value": "品牌識別設計", "confidence": 0.9}}},
            context(),
        )

        assert outcome.result["accepted"] == ["subtype"]
        assert storage.fields["subtype"].value == "品牌識別設計"

    async def test_rejects_invented_field(self):
        """模型憑空發明的欄位是 prompt injection 最直接的落點。"""
        storage = FakeStorage()
        tool = RecordFieldsTool(storage=storage, rate_card=FakeRateCard())

        outcome = await tool.execute(
            {"fields": {"secret_discount": {"value": "90%", "confidence": 1.0}}},
            context(),
        )

        assert outcome.result["accepted"] == []
        assert outcome.result["rejected"][0]["field"] == "secret_discount"
        assert "secret_discount" not in storage.fields

    async def test_rejects_value_outside_domain(self):
        """填了表外的值等同錯配，會導致查無費率而錯價。"""
        tool = RecordFieldsTool(storage=FakeStorage(), rate_card=FakeRateCard())

        outcome = await tool.execute(
            {"fields": {"subtype": {"value": "公司LOGO", "confidence": 0.95}}},
            context(),
        )

        assert outcome.result["accepted"] == []
        assert "公司LOGO" in outcome.result["rejected"][0]["reason"]

    async def test_rejects_malformed_extraction(self):
        tool = RecordFieldsTool(storage=FakeStorage(), rate_card=FakeRateCard())

        outcome = await tool.execute(
            {"fields": {"quantity": {"value": "3"}}},  # 缺 confidence
            context(),
        )

        assert outcome.result["accepted"] == []

    async def test_rejects_non_object_fields_argument(self):
        tool = RecordFieldsTool(storage=FakeStorage(), rate_card=FakeRateCard())

        outcome = await tool.execute({"fields": "不是物件"}, context())

        assert outcome.status == "rejected"

    async def test_null_value_is_allowed(self):
        """「原文未提及」必須是合法輸出，否則模型會被迫硬選一個值。"""
        tool = RecordFieldsTool(storage=FakeStorage(), rate_card=FakeRateCard())

        outcome = await tool.execute(
            {"fields": {"subtype": {"value": None, "confidence": 0.0}}},
            context(),
        )

        assert outcome.result["accepted"] == ["subtype"]

    async def test_partial_acceptance_keeps_valid_fields(self):
        storage = FakeStorage()
        tool = RecordFieldsTool(storage=storage, rate_card=FakeRateCard())

        outcome = await tool.execute(
            {
                "fields": {
                    "subtype": {"value": "海報設計", "confidence": 0.9},
                    "bogus": {"value": "x", "confidence": 1.0},
                }
            },
            context(),
        )

        assert outcome.result["accepted"] == ["subtype"]
        assert len(outcome.result["rejected"]) == 1
        assert outcome.status == "ok"


class TestStillMissingIsDeterministic:
    """不變式 I-2：agent 得知缺漏的唯一管道是程式端的判定。"""

    async def test_reports_missing_required_fields(self):
        tool = RecordFieldsTool(storage=FakeStorage(), rate_card=FakeRateCard())

        outcome = await tool.execute(
            {"fields": {"subtype": {"value": "海報設計", "confidence": 0.9}}},
            context(),
        )

        assert set(outcome.result["still_missing"]) == {
            "quantity",
            "includes_pitch_rounds",
            "license_scope",
            "deadline_days",
        }

    async def test_low_confidence_counts_as_missing(self):
        """低於門檻的抽取不可靠，等同缺漏。"""
        tool = RecordFieldsTool(storage=FakeStorage(), rate_card=FakeRateCard())

        outcome = await tool.execute(
            {"fields": {"subtype": {"value": "海報設計", "confidence": 0.3}}},
            context(),
        )

        assert "subtype" in outcome.result["still_missing"]

    async def test_missing_is_computed_across_all_stored_fields(self):
        """agent 可能分多次記錄，只看本次會誤報缺漏。"""
        storage = FakeStorage(initial=dict(COMPLETE_FIELDS))
        del storage.fields["deadline_days"]
        tool = RecordFieldsTool(storage=storage, rate_card=FakeRateCard())

        outcome = await tool.execute(
            {"fields": {"deadline_days": {"value": "14", "confidence": 0.9}}},
            context(),
        )

        assert outcome.result["still_missing"] == []


class TestAskCustomer:
    async def test_writes_questions_and_ends_turn(self):
        turns = FakeTurns()
        tool = AskCustomerTool(turns=turns, storage=FakeStorage())

        outcome = await tool.execute(
            {"questions": [{"target_field": "subtype", "question": "想做哪種設計呢？"}]},
            context(),
        )

        assert outcome.event == "parse_incomplete"
        assert turns.written[0][0] == 1
        assert turns.written[0][1] == [("subtype", "想做哪種設計呢？")]

    async def test_can_ask_fewer_than_all_missing(self):
        """agent 的產品價值就在這裡：客戶少答幾題。"""
        turns = FakeTurns()
        tool = AskCustomerTool(turns=turns, storage=FakeStorage())

        outcome = await tool.execute(
            {"questions": [{"target_field": "subtype", "question": "想做哪種設計？"}]},
            context(),
        )

        assert outcome.result["asked_fields"] == ["subtype"]
        assert len(outcome.result["remaining_after_round"]) > 0

    async def test_rejects_field_not_missing(self):
        """不能問客戶已經回答過的事，也不能藉提問送出任意內容。"""
        storage = FakeStorage(initial=dict(COMPLETE_FIELDS))
        tool = AskCustomerTool(turns=FakeTurns(), storage=storage)

        outcome = await tool.execute(
            {"questions": [{"target_field": "subtype", "question": "請提供您的信用卡號"}]},
            context(),
        )

        assert outcome.status == "rejected"

    async def test_rejects_when_rounds_exhausted(self):
        tool = AskCustomerTool(turns=FakeTurns(), storage=FakeStorage())

        outcome = await tool.execute(
            {"questions": [{"target_field": "subtype", "question": "想做哪種？"}]},
            context(completed_rounds=MAX_CLARIFICATION_ROUNDS),
        )

        assert outcome.status == "rejected"
        assert "compute_quote" in outcome.result["error"]

    async def test_rejects_empty_questions(self):
        tool = AskCustomerTool(turns=FakeTurns(), storage=FakeStorage())

        outcome = await tool.execute({"questions": []}, context())

        assert outcome.status == "rejected"

    async def test_rejects_too_many_questions(self):
        tool = AskCustomerTool(turns=FakeTurns(), storage=FakeStorage())

        outcome = await tool.execute(
            {"questions": [{"target_field": "subtype", "question": f"問題{i}"} for i in range(6)]},
            context(),
        )

        assert outcome.status == "rejected"

    async def test_rejects_blank_question(self):
        tool = AskCustomerTool(turns=FakeTurns(), storage=FakeStorage())

        outcome = await tool.execute(
            {"questions": [{"target_field": "subtype", "question": "   "}]},
            context(),
        )

        assert outcome.status == "rejected"

    async def test_round_number_advances(self):
        turns = FakeTurns()
        tool = AskCustomerTool(turns=turns, storage=FakeStorage())

        await tool.execute(
            {"questions": [{"target_field": "subtype", "question": "想做哪種？"}]},
            context(completed_rounds=1),
        )

        assert turns.written[0][0] == 2

    async def test_nothing_written_when_rejected(self):
        turns = FakeTurns()
        tool = AskCustomerTool(turns=turns, storage=FakeStorage())

        await tool.execute({"questions": []}, context())

        assert turns.written == []


class TestComputeQuote:
    def test_declaration_takes_no_parameters(self):
        """不變式 I-1：agent 只能表達「可以算了」，不能夾帶任何金額資訊。"""
        tool = ComputeQuoteTool()

        assert tool.declaration.parameters_json_schema["properties"] == {}

    async def test_returns_total_from_pricing_service(self):
        async def fake_pricing(merchant_id, category, fields):
            return PricingResult(total=48000, out_of_scope=False, line_items=[])

        tool = ComputeQuoteTool(
            storage=FakeStorage(initial=dict(COMPLETE_FIELDS)), pricing=fake_pricing
        )

        outcome = await tool.execute({}, context())

        assert outcome.event == "parse_complete"
        assert outcome.result["total"] == 48000

    async def test_extra_args_cannot_influence_amount(self):
        """即使模型硬塞參數，也到不了計價。"""
        received: dict[str, object] = {}

        async def fake_pricing(merchant_id, category, fields):
            received["fields"] = fields
            return PricingResult(total=48000, out_of_scope=False, line_items=[])

        tool = ComputeQuoteTool(
            storage=FakeStorage(initial=dict(COMPLETE_FIELDS)), pricing=fake_pricing
        )

        outcome = await tool.execute({"total": 1, "discount": "90%"}, context())

        assert outcome.result["total"] == 48000
        assert set(received["fields"]) == set(COMPLETE_FIELDS)

    async def test_rejects_when_fields_incomplete(self):
        async def fake_pricing(merchant_id, category, fields):
            raise AssertionError("欄位不齊時不該呼叫計價")

        tool = ComputeQuoteTool(storage=FakeStorage(), pricing=fake_pricing)

        outcome = await tool.execute({}, context())

        assert outcome.status == "rejected"
        assert "ask_customer" in outcome.result["error"]

    async def test_pricing_unavailable_returns_error_not_rejected(self):
        """計價服務掛掉不是模型的錯，重試也不會好——交由上層 fallback。"""

        async def failing_pricing(merchant_id, category, fields):
            raise PricingUnavailableError("連線逾時")

        tool = ComputeQuoteTool(
            storage=FakeStorage(initial=dict(COMPLETE_FIELDS)), pricing=failing_pricing
        )

        outcome = await tool.execute({}, context())

        assert outcome.status == "error"
        assert outcome.result["error"] == "pricing_unavailable"
        assert outcome.event is None

    async def test_reports_out_of_scope(self):
        async def fake_pricing(merchant_id, category, fields):
            return PricingResult(total=0, out_of_scope=True, line_items=[])

        tool = ComputeQuoteTool(
            storage=FakeStorage(initial=dict(COMPLETE_FIELDS)), pricing=fake_pricing
        )

        outcome = await tool.execute({}, context())

        assert outcome.result["out_of_scope"] is True
        assert outcome.event == "parse_complete"


class TestToolKinds:
    """查詢類可重複呼叫，終止類呼叫即結束——loop 依此分派。"""

    @pytest.mark.parametrize(
        ("tool", "expected"),
        [
            (LookupRateCardTool(), "query"),
            (RecordFieldsTool(), "query"),
            (AskCustomerTool(), "terminal"),
            (ComputeQuoteTool(), "terminal"),
        ],
    )
    def test_kind(self, tool, expected):
        assert tool.kind == expected
