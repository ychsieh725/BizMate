"""pytest 共用 fixture。

設定測試用環境變數必須在 import app 之前完成——config.py 於 import 時即建立
Settings 實例（fail-fast 設計），環境變數晚設會導致 import 失敗。

**用直接指派而非 setdefault。** setdefault 會讓外部既有的值勝出，於是測試的
行為取決於執行者的 shell 或 CI 設定：只要環境裡有一個不同的
INTERNAL_SERVICE_SECRET，服務端讀到的就與 secret_header 送出的不一致，
所有需要認證的測試會全數變成 401——而錯誤訊息只會說「預期 200 得到 401」，
完全看不出根因。單元測試全部使用假的相依，不需要也不該吃外部環境的值。
"""

import os

import pytest

TEST_SECRET = "test-internal-secret-value"

os.environ["INTERNAL_SERVICE_SECRET"] = TEST_SECRET
os.environ["SUPABASE_URL"] = "https://supabase.test"
os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "test-service-role-key"
os.environ["GEMINI_API_KEY"] = "test-gemini-api-key"
os.environ["WEB_SERVICE_URL"] = "https://web.test"


@pytest.fixture
def client():
    """帶入合法設定的 FastAPI TestClient。"""
    from fastapi.testclient import TestClient

    from app.main import app

    return TestClient(app)


@pytest.fixture
def secret_header() -> dict[str, str]:
    """通過內部認證的請求標頭。"""
    return {"x-internal-secret": TEST_SECRET}
