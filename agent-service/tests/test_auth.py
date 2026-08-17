"""內部服務認證。

設計文件〈安全考量〉的 v3 註記：Python 與 Next.js 共用 domain **不代表**
此服務受保護——端點仍可被外部直接請求。故業務端點一律要求 shared secret，
不因同域而省略。這組測試就是那條規則的機械化驗收。
"""

from tests.conftest import TEST_SECRET


def test_business_endpoint_rejects_missing_secret(client):
    """未帶 secret → 401，且不執行任何業務邏輯。"""
    response = client.post("/agent/echo", json={"message": "hello"})

    assert response.status_code == 401
    assert response.json()["success"] is False


def test_business_endpoint_rejects_wrong_secret(client):
    """secret 錯誤 → 401。"""
    response = client.post(
        "/agent/echo",
        json={"message": "hello"},
        headers={"x-internal-secret": "wrong-value"},
    )

    assert response.status_code == 401


def test_business_endpoint_rejects_secret_prefix(client):
    """正確值的前綴不得通過——防止逐字元比對造成的旁通道。"""
    response = client.post(
        "/agent/echo",
        json={"message": "hello"},
        headers={"x-internal-secret": TEST_SECRET[:-1]},
    )

    assert response.status_code == 401


def test_auth_failure_does_not_leak_expected_secret(client):
    """401 訊息不得回傳或暗示正確的 secret 值。"""
    response = client.post("/agent/echo", json={"message": "hello"})

    assert TEST_SECRET not in response.text


def test_business_endpoint_accepts_valid_secret(client, secret_header):
    """帶正確 secret → 放行。"""
    response = client.post("/agent/echo", json={"message": "hello"}, headers=secret_header)

    assert response.status_code == 200
