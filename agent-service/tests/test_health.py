"""健康檢查端點。

/health 刻意不需認證：Vercel 與外部監控要能在沒有 secret 的情況下探活。
它也因此不得洩漏任何設定內容（不回傳 URL、金鑰、環境變數）。
"""


def test_health_is_public(client):
    """未帶 secret 也能取得 200——探活不應依賴認證。"""
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["success"] is True


def test_health_reports_service_identity(client):
    """回傳服務識別，讓部署後能確認打到的是正確的服務。"""
    data = client.get("/health").json()["data"]

    assert data["service"] == "agent-service"
    assert data["status"] == "ok"
    assert "version" in data


def test_health_does_not_leak_configuration(client):
    """探活回應不得包含任何機密值。"""
    body = client.get("/health").text

    assert "INTERNAL_SERVICE_SECRET" not in body
    assert "test-internal-secret-value" not in body
