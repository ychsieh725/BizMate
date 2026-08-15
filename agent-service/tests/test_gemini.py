"""Gemini 呼叫層。

用假 client 取代真實 SDK——這一層的邏輯（重試、退避、usage 萃取、
function_call 解析）完全不需要網路就能驗證，且假 client 能重現真實環境難以
製造的情境（第一次失敗第二次成功、usage 欄位缺漏、模型回空回應）。
"""

import json

import pytest
from google.genai import types
from pydantic import BaseModel

from app.llm import gemini
from app.llm.types import GeminiError

pytestmark = pytest.mark.usefixtures("no_backoff_sleep")


class Answer(BaseModel):
    """測試用的結構化輸出形狀。"""

    subtype: str
    quantity: int


def make_response(
    text: str | None = None,
    function_call: tuple[str, dict[str, object]] | None = None,
    prompt_tokens: int | None = 100,
    output_tokens: int | None = 50,
    total_tokens: int | None = 150,
) -> types.GenerateContentResponse:
    """組出一個 Gemini 回應。"""
    parts: list[types.Part] = []
    if text is not None:
        parts.append(types.Part(text=text))
    if function_call is not None:
        name, args = function_call
        parts.append(types.Part(function_call=types.FunctionCall(name=name, args=args)))

    return types.GenerateContentResponse(
        candidates=[types.Candidate(content=types.Content(parts=parts, role="model"))],
        usage_metadata=types.GenerateContentResponseUsageMetadata(
            prompt_token_count=prompt_tokens,
            candidates_token_count=output_tokens,
            total_token_count=total_tokens,
        ),
    )


class FakeModels:
    """記錄呼叫並依序回傳預設結果的假 models API。"""

    def __init__(self, outcomes: list[object]) -> None:
        self._outcomes = list(outcomes)
        self.calls: list[dict[str, object]] = []

    async def generate_content(self, **kwargs: object) -> types.GenerateContentResponse:
        self.calls.append(kwargs)
        outcome = self._outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        assert isinstance(outcome, types.GenerateContentResponse)
        return outcome


class FakeClient:
    def __init__(self, outcomes: list[object]) -> None:
        self.models = FakeModels(outcomes)
        self.aio = self


@pytest.fixture
def no_backoff_sleep(monkeypatch):
    """退避改為不等待——測試要驗證的是重試次數，不是真的等 400 毫秒。"""

    async def instant(_seconds: float) -> None:
        return None

    monkeypatch.setattr(gemini.asyncio, "sleep", instant)


def install_client(monkeypatch, outcomes: list[object]) -> FakeClient:
    client = FakeClient(outcomes)
    monkeypatch.setattr(gemini, "get_client", lambda: client)
    return client


VALID_JSON = json.dumps({"subtype": "品牌識別設計", "quantity": 3})


class TestGenerateStructured:
    async def test_returns_parsed_model(self, monkeypatch):
        install_client(monkeypatch, [make_response(text=VALID_JSON)])

        result = await gemini.generate_structured(tier="light", prompt="抽取欄位", schema=Answer)

        assert result.data.subtype == "品牌識別設計"
        assert result.data.quantity == 3

    async def test_reports_model_name(self, monkeypatch):
        install_client(monkeypatch, [make_response(text=VALID_JSON)])

        result = await gemini.generate_structured(tier="light", prompt="抽取欄位", schema=Answer)

        assert result.model == "gemini-3.1-flash-lite"

    async def test_extracts_token_usage(self, monkeypatch):
        install_client(monkeypatch, [make_response(text=VALID_JSON)])

        result = await gemini.generate_structured(tier="light", prompt="抽取欄位", schema=Answer)

        assert result.usage.input_tokens == 100
        assert result.usage.output_tokens == 50
        assert result.usage.total_tokens == 150

    async def test_passes_json_schema_to_model(self, monkeypatch):
        """schema 必須真的送進去，否則結構化輸出的硬約束等於沒設。"""
        client = install_client(monkeypatch, [make_response(text=VALID_JSON)])

        await gemini.generate_structured(tier="light", prompt="抽取欄位", schema=Answer)

        config = client.models.calls[0]["config"]
        assert config.response_json_schema == Answer.model_json_schema()
        assert config.response_mime_type == "application/json"

    async def test_passes_system_instruction_when_given(self, monkeypatch):
        client = install_client(monkeypatch, [make_response(text=VALID_JSON)])

        await gemini.generate_structured(
            tier="light",
            prompt="抽取欄位",
            schema=Answer,
            system_instruction="你是解析助手",
        )

        assert client.models.calls[0]["config"].system_instruction == "你是解析助手"

    async def test_disables_automatic_function_calling(self, monkeypatch):
        """結構化輸出永不需要 function calling。

        SDK 預設啟用 AFC，未明確關閉時即使沒給 tools 也會走進 AFC 的 while
        迴圈路徑。明確關掉可走最直接的路徑，也讓「本層不做多輪」是顯式的。
        """
        client = install_client(monkeypatch, [make_response(text=VALID_JSON)])

        await gemini.generate_structured(tier="light", prompt="抽取欄位", schema=Answer)

        config = client.models.calls[0]["config"]
        assert config.automatic_function_calling.disable is True

    async def test_omits_system_instruction_when_absent(self, monkeypatch):
        client = install_client(monkeypatch, [make_response(text=VALID_JSON)])

        await gemini.generate_structured(tier="light", prompt="抽取欄位", schema=Answer)

        assert client.models.calls[0]["config"].system_instruction is None


class TestRetry:
    """重試涵蓋網路錯誤與 malformed 輸出。"""

    async def test_retries_once_after_network_error(self, monkeypatch):
        client = install_client(
            monkeypatch,
            [ConnectionError("連線中斷"), make_response(text=VALID_JSON)],
        )

        result = await gemini.generate_structured(tier="light", prompt="抽取欄位", schema=Answer)

        assert result.data.quantity == 3
        assert len(client.models.calls) == 2

    async def test_retries_on_malformed_json(self, monkeypatch):
        """回傳不是合法 JSON 也該重試——下次取樣可能就對了。"""
        client = install_client(
            monkeypatch,
            [make_response(text="這不是 JSON"), make_response(text=VALID_JSON)],
        )

        result = await gemini.generate_structured(tier="light", prompt="抽取欄位", schema=Answer)

        assert result.data.quantity == 3
        assert len(client.models.calls) == 2

    async def test_retries_when_schema_does_not_match(self, monkeypatch):
        """JSON 合法但不符 schema，同樣重試。"""
        client = install_client(
            monkeypatch,
            [
                make_response(text=json.dumps({"unexpected": "shape"})),
                make_response(text=VALID_JSON),
            ],
        )

        await gemini.generate_structured(tier="light", prompt="抽取欄位", schema=Answer)

        assert len(client.models.calls) == 2

    async def test_gives_up_after_one_retry(self, monkeypatch):
        """只重試一次；第二次仍失敗即拋 GeminiError，把時間留給 fallback。"""
        client = install_client(
            monkeypatch,
            [ConnectionError("連線中斷"), ConnectionError("又斷了")],
        )

        with pytest.raises(GeminiError):
            await gemini.generate_structured(tier="light", prompt="抽取欄位", schema=Answer)

        assert len(client.models.calls) == 2

    async def test_error_carries_model_context(self, monkeypatch):
        install_client(monkeypatch, [ValueError("boom"), ValueError("boom")])

        with pytest.raises(GeminiError) as exc_info:
            await gemini.generate_structured(tier="light", prompt="抽取欄位", schema=Answer)

        assert "gemini-3.1-flash-lite" in str(exc_info.value)

    async def test_empty_response_is_treated_as_failure(self, monkeypatch):
        client = install_client(
            monkeypatch, [make_response(text=None), make_response(text=VALID_JSON)]
        )

        await gemini.generate_structured(tier="light", prompt="抽取欄位", schema=Answer)

        assert len(client.models.calls) == 2


class TestUsageExtraction:
    """usage 欄位缺漏不得讓呼叫崩掉。"""

    async def test_missing_usage_fields_default_to_zero(self, monkeypatch):
        install_client(
            monkeypatch,
            [
                make_response(
                    text=VALID_JSON,
                    prompt_tokens=None,
                    output_tokens=None,
                    total_tokens=None,
                )
            ],
        )

        result = await gemini.generate_structured(tier="light", prompt="抽取欄位", schema=Answer)

        assert result.usage.input_tokens == 0
        assert result.usage.output_tokens == 0

    def test_total_falls_back_to_sum(self):
        usage = gemini.extract_usage(
            types.GenerateContentResponseUsageMetadata(
                prompt_token_count=10, candidates_token_count=5, total_token_count=None
            )
        )

        assert usage.total_tokens == 15

    def test_absent_metadata_yields_zeros(self):
        usage = gemini.extract_usage(None)

        assert usage.total_tokens == 0


class TestGenerateWithTools:
    async def test_returns_tool_call(self, monkeypatch):
        install_client(
            monkeypatch,
            [make_response(function_call=("lookup_rate_card", {"category": "graphic"}))],
        )

        result = await gemini.generate_with_tools(tier="light", contents=[], tools=[])

        assert result.tool_call is not None
        assert result.tool_call.name == "lookup_rate_card"
        assert result.tool_call.args == {"category": "graphic"}

    async def test_returns_text_when_no_tool_call(self, monkeypatch):
        install_client(monkeypatch, [make_response(text="我需要更多資訊")])

        result = await gemini.generate_with_tools(tier="light", contents=[], tools=[])

        assert result.tool_call is None
        assert result.text == "我需要更多資訊"

    async def test_takes_only_first_tool_call(self, monkeypatch):
        """一次只處理一個 tool，讓每步能獨立記軌跡並獨立計入預算。"""
        response = types.GenerateContentResponse(
            candidates=[
                types.Candidate(
                    content=types.Content(
                        parts=[
                            types.Part(function_call=types.FunctionCall(name="first", args={})),
                            types.Part(function_call=types.FunctionCall(name="second", args={})),
                        ],
                        role="model",
                    )
                )
            ]
        )
        install_client(monkeypatch, [response])

        result = await gemini.generate_with_tools(tier="light", contents=[], tools=[])

        assert result.tool_call is not None
        assert result.tool_call.name == "first"

    async def test_disables_automatic_function_calling(self, monkeypatch):
        """SDK 自動執行 tool 會把迴圈控制權奪走，必須關閉。"""
        client = install_client(monkeypatch, [make_response(text="ok")])

        await gemini.generate_with_tools(tier="light", contents=[], tools=[])

        config = client.models.calls[0]["config"]
        assert config.automatic_function_calling.disable is True

    async def test_passes_tool_declarations(self, monkeypatch):
        client = install_client(monkeypatch, [make_response(text="ok")])
        declaration = types.FunctionDeclaration(name="lookup_rate_card", description="查詢服務項目")

        await gemini.generate_with_tools(tier="light", contents=[], tools=[declaration])

        config = client.models.calls[0]["config"]
        assert config.tools[0].function_declarations[0].name == "lookup_rate_card"

    async def test_records_usage_for_each_turn(self, monkeypatch):
        """每一輪都是獨立計費的呼叫，usage 必須逐輪回報。"""
        install_client(monkeypatch, [make_response(text="ok", prompt_tokens=222)])

        result = await gemini.generate_with_tools(tier="light", contents=[], tools=[])

        assert result.usage.input_tokens == 222

    async def test_retries_on_failure(self, monkeypatch):
        client = install_client(monkeypatch, [ConnectionError("斷線"), make_response(text="ok")])

        await gemini.generate_with_tools(tier="light", contents=[], tools=[])

        assert len(client.models.calls) == 2
