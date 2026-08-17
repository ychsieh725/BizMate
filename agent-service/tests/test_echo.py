"""echo 端點——A0 的接縫驗收。

這個端點沒有業務價值，唯一任務是證明「TypeScript → Python 的呼叫鏈打通了」：
路由正確、認證生效、請求主體解析正常、回應信封與 TS 端一致。
A3 起會被真正的 /agent/resolve 取代。
"""


def test_echo_returns_message(client, secret_header):
    """回傳送進去的訊息，證明主體解析正確。"""
    response = client.post("/agent/echo", json={"message": "來自 Next.js"}, headers=secret_header)

    assert response.json()["data"]["echo"] == "來自 Next.js"


def test_echo_uses_shared_response_envelope(client, secret_header):
    """信封與 TS 端 apiOk/apiFail 一致：success / data / error 三鍵。"""
    body = client.post("/agent/echo", json={"message": "x"}, headers=secret_header).json()

    assert set(body.keys()) == {"success", "data", "error"}
    assert body["error"] is None


def test_echo_reports_service_identity(client, secret_header):
    """回傳服務名，讓 TS 端能斷言打到的是 agent-service 而非其他服務。"""
    data = client.post("/agent/echo", json={"message": "x"}, headers=secret_header).json()["data"]

    assert data["service"] == "agent-service"


def test_echo_rejects_missing_message(client, secret_header):
    """缺少必要欄位 → 422，由 Pydantic 在邊界擋下。"""
    response = client.post("/agent/echo", json={}, headers=secret_header)

    assert response.status_code == 422


def test_echo_rejects_oversized_message(client, secret_header):
    """長度上限沿用客戶描述的 2000 字約束（設計文件〈安全考量〉輸入層）。"""
    response = client.post("/agent/echo", json={"message": "字" * 2001}, headers=secret_header)

    assert response.status_code == 422


def test_validation_error_uses_shared_envelope(client, secret_header):
    """422 也要走統一信封——TS 端只需一套解析邏輯。"""
    body = client.post("/agent/echo", json={}, headers=secret_header).json()

    assert body["success"] is False
    assert body["data"] is None
    assert isinstance(body["error"], str)
