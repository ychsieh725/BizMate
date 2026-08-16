"""POST /agent/resolve。

重點在回應契約：TypeScript 端依這份形狀決定要接受 agent 的決定還是 fallback。
契約錯了，兩邊都會編譯通過但行為錯亂——這正是跨語言邊界最危險的地方。
"""

from uuid import uuid4

import pytest

from app.agent.loop import LoopResult

SESSION_ID = "11111111-1111-4111-8111-111111111111"
MERCHANT_ID = "22222222-2222-4222-8222-222222222222"

VALID_BODY = {
    "session_id": SESSION_ID,
    "merchant_id": MERCHANT_ID,
    "category": "graphic_design",
    "raw_text": "我要做三款品牌識別設計",
}


def completed_result(event: str = "parse_complete") -> LoopResult:
    return LoopResult(
        outcome="completed",
        run_id=uuid4(),
        steps_taken=3,
        total_latency_ms=1200,
        total_cost_usd=0.00042,
        event=event,  # type: ignore[arg-type]
        tool_result={"total": 48000},
    )


def fallback_result(reason: str = "steps_exhausted") -> LoopResult:
    return LoopResult(
        outcome="fallback",
        run_id=uuid4(),
        steps_taken=8,
        total_latency_ms=6400,
        total_cost_usd=0.0031,
        fallback_reason=reason,  # type: ignore[arg-type]
    )


@pytest.fixture
def stub_loop(monkeypatch):
    """讓端點測試不必跑真的 loop。"""

    def install(result: LoopResult):
        captured: dict[str, object] = {}

        async def fake_loop(context, prompt, **kwargs):
            captured["context"] = context
            captured["prompt"] = prompt
            return result

        monkeypatch.setattr("app.api.resolve.run_agent_loop", fake_loop)
        return captured

    return install


class TestAuth:
    def test_requires_internal_secret(self, client):
        response = client.post("/agent/resolve", json=VALID_BODY)

        assert response.status_code == 401


class TestValidation:
    def test_rejects_missing_session_id(self, client, secret_header):
        body = {k: v for k, v in VALID_BODY.items() if k != "session_id"}

        response = client.post("/agent/resolve", json=body, headers=secret_header)

        assert response.status_code == 422

    def test_rejects_unknown_category(self, client, secret_header):
        body = {**VALID_BODY, "category": "not_a_category"}

        response = client.post("/agent/resolve", json=body, headers=secret_header)

        assert response.status_code == 422

    def test_rejects_oversized_raw_text(self, client, secret_header):
        """長度上限與 TS 端 zod 驗證一致——邊界越前面越好，但兩層都要有。"""
        body = {**VALID_BODY, "raw_text": "字" * 2001}

        response = client.post("/agent/resolve", json=body, headers=secret_header)

        assert response.status_code == 422

    def test_rejects_negative_completed_rounds(self, client, secret_header):
        body = {**VALID_BODY, "completed_rounds": -1}

        response = client.post("/agent/resolve", json=body, headers=secret_header)

        assert response.status_code == 422


class TestCompletedOutcome:
    def test_returns_event(self, client, secret_header, stub_loop):
        stub_loop(completed_result("parse_complete"))

        body = client.post("/agent/resolve", json=VALID_BODY, headers=secret_header).json()

        assert body["data"]["outcome"] == "completed"
        assert body["data"]["event"] == "parse_complete"

    def test_returns_tool_result(self, client, secret_header, stub_loop):
        stub_loop(completed_result())

        body = client.post("/agent/resolve", json=VALID_BODY, headers=secret_header).json()

        assert body["data"]["tool_result"] == {"total": 48000}

    def test_returns_usage_metrics(self, client, secret_header, stub_loop):
        """trajectory eval 要靠這些數字，缺一項就少一個指標。"""
        stub_loop(completed_result())

        data = client.post("/agent/resolve", json=VALID_BODY, headers=secret_header).json()["data"]

        assert data["steps_taken"] == 3
        assert data["total_latency_ms"] == 1200
        assert data["total_cost_usd"] == 0.00042
        assert data["run_id"]


class TestFallbackOutcome:
    def test_fallback_is_http_200_not_an_error(self, client, secret_header, stub_loop):
        """fallback 是正常回應。回 5xx 會讓呼叫端把它當故障處理。"""
        stub_loop(fallback_result())

        response = client.post("/agent/resolve", json=VALID_BODY, headers=secret_header)

        assert response.status_code == 200
        assert response.json()["success"] is True

    def test_reports_fallback_reason(self, client, secret_header, stub_loop):
        stub_loop(fallback_result("stuck_in_loop"))

        data = client.post("/agent/resolve", json=VALID_BODY, headers=secret_header).json()["data"]

        assert data["outcome"] == "fallback"
        assert data["fallback_reason"] == "stuck_in_loop"
        assert data["event"] is None


class TestContextConstruction:
    def test_passes_tenant_scope_from_request(self, client, secret_header, stub_loop):
        """商家與類別由呼叫端決定，不由模型指定——否則等於能跨租戶操作。"""
        captured = stub_loop(completed_result())

        client.post("/agent/resolve", json=VALID_BODY, headers=secret_header)

        context = captured["context"]
        assert context.merchant_id == MERCHANT_ID
        assert context.session_id == SESSION_ID
        assert context.category == "graphic_design"

    def test_passes_completed_rounds(self, client, secret_header, stub_loop):
        captured = stub_loop(completed_result())

        client.post(
            "/agent/resolve",
            json={**VALID_BODY, "completed_rounds": 2},
            headers=secret_header,
        )

        assert captured["context"].completed_rounds == 2

    def test_includes_prior_answers_in_prompt(self, client, secret_header, stub_loop):
        """沒有脈絡，agent 會重複問客戶已經回答過的事。"""
        captured = stub_loop(completed_result())

        client.post(
            "/agent/resolve",
            json={
                **VALID_BODY,
                "prior_answers": [{"question": "要幾款呢？", "answer": "三款"}],
            },
            headers=secret_header,
        )

        assert "要幾款呢？" in captured["prompt"]
        assert "三款" in captured["prompt"]

    def test_raw_text_appears_in_prompt(self, client, secret_header, stub_loop):
        captured = stub_loop(completed_result())

        client.post("/agent/resolve", json=VALID_BODY, headers=secret_header)

        assert "我要做三款品牌識別設計" in captured["prompt"]
