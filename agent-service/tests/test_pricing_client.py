"""內部計價 API 的 client——不變式 I-1 的 Python 側。

用 httpx 的 MockTransport 攔下請求，驗證兩件事：
1. 送出的請求**只含欄位值，不含任何金額**
2. 各種失敗一律轉成 PricingUnavailableError，讓上層能 fallback
"""

import json

import httpx
import pytest

from app.agent.fields import FieldExtraction
from app.pricing_client import (
    PricingUnavailableError,
    compute_pricing,
)

MERCHANT_ID = "22222222-2222-4222-8222-222222222222"

FIELDS = {
    "subtype": FieldExtraction(value="品牌識別設計", confidence=0.9, source_span="LOGO"),
    "quantity": FieldExtraction(value="3", confidence=0.95, source_span="三款"),
}

SUCCESS_BODY = {
    "success": True,
    "data": {
        "total": 48000,
        "out_of_scope": False,
        "line_items": [
            {
                "item_name": "品牌識別設計 × 3",
                "amount": 48000,
                "rule_id": "rule-1",
                "modifier_id": None,
                "agent_reasoning": None,
            }
        ],
    },
    "error": None,
}


def install_transport(monkeypatch, handler):
    """讓 compute_pricing 內部建立的 AsyncClient 使用假 transport。"""
    original = httpx.AsyncClient

    def factory(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return original(*args, **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", factory)


class TestRequestShape:
    """請求只帶欄位值——這是 I-1 在 Python 側的具體表現。"""

    async def test_sends_only_field_values(self, monkeypatch):
        captured: dict[str, object] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["json"] = json.loads(request.content)
            return httpx.Response(200, json=SUCCESS_BODY)

        install_transport(monkeypatch, handler)

        await compute_pricing(MERCHANT_ID, "graphic_design", FIELDS)

        sent = captured["json"]
        assert sent["fields"] == {
            "subtype": {"value": "品牌識別設計"},
            "quantity": {"value": "3"},
        }

    async def test_does_not_send_any_amount(self, monkeypatch):
        """請求主體不得出現任何與金額相關的鍵。"""
        captured: dict[str, object] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["raw"] = request.content.decode()
            return httpx.Response(200, json=SUCCESS_BODY)

        install_transport(monkeypatch, handler)

        await compute_pricing(MERCHANT_ID, "graphic_design", FIELDS)

        raw = captured["raw"]
        for forbidden in ("total", "amount", "price", "discount"):
            assert forbidden not in raw

    async def test_sends_internal_secret_header(self, monkeypatch):
        captured: dict[str, object] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["secret"] = request.headers.get("x-internal-secret")
            return httpx.Response(200, json=SUCCESS_BODY)

        install_transport(monkeypatch, handler)

        await compute_pricing(MERCHANT_ID, "graphic_design", FIELDS)

        assert captured["secret"] == "test-internal-secret-value"

    async def test_targets_internal_compute_path(self, monkeypatch):
        captured: dict[str, object] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["url"] = str(request.url)
            return httpx.Response(200, json=SUCCESS_BODY)

        install_transport(monkeypatch, handler)

        await compute_pricing(MERCHANT_ID, "graphic_design", FIELDS)

        assert captured["url"] == "https://web.test/api/internal/pricing/compute"


class TestSuccessPath:
    async def test_parses_pricing_result(self, monkeypatch):
        install_transport(monkeypatch, lambda _r: httpx.Response(200, json=SUCCESS_BODY))

        result = await compute_pricing(MERCHANT_ID, "graphic_design", FIELDS)

        assert result.total == 48000
        assert result.out_of_scope is False
        assert result.line_items[0].item_name == "品牌識別設計 × 3"

    async def test_handles_out_of_scope(self, monkeypatch):
        body = {
            "success": True,
            "data": {"total": 0, "out_of_scope": True, "line_items": []},
            "error": None,
        }
        install_transport(monkeypatch, lambda _r: httpx.Response(200, json=body))

        result = await compute_pricing(MERCHANT_ID, "graphic_design", FIELDS)

        assert result.out_of_scope is True


class TestFailurePaths:
    """任何失敗都要轉成 PricingUnavailableError，讓上層能 fallback。"""

    async def test_connection_error(self, monkeypatch):
        def handler(_request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("連線被拒")

        install_transport(monkeypatch, handler)

        with pytest.raises(PricingUnavailableError):
            await compute_pricing(MERCHANT_ID, "graphic_design", FIELDS)

    async def test_unauthorized(self, monkeypatch):
        install_transport(
            monkeypatch,
            lambda _r: httpx.Response(
                401, json={"success": False, "data": None, "error": "認證失敗"}
            ),
        )

        with pytest.raises(PricingUnavailableError):
            await compute_pricing(MERCHANT_ID, "graphic_design", FIELDS)

    async def test_server_error(self, monkeypatch):
        install_transport(monkeypatch, lambda _r: httpx.Response(500))

        with pytest.raises(PricingUnavailableError):
            await compute_pricing(MERCHANT_ID, "graphic_design", FIELDS)

    async def test_envelope_reports_failure(self, monkeypatch):
        """HTTP 200 但信封標記失敗，同樣視為無法計價。"""
        body = {"success": False, "data": None, "error": "計價失敗"}
        install_transport(monkeypatch, lambda _r: httpx.Response(200, json=body))

        with pytest.raises(PricingUnavailableError):
            await compute_pricing(MERCHANT_ID, "graphic_design", FIELDS)
