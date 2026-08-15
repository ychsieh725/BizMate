"""pytest 共用 fixture。

設定測試用環境變數必須在 import app 之前完成——config.py 於 import 時即建立
Settings 實例（fail-fast 設計），環境變數晚設會導致 import 失敗。
"""

import os

import pytest

TEST_SECRET = "test-internal-secret-value"

os.environ.setdefault("INTERNAL_SERVICE_SECRET", TEST_SECRET)
os.environ.setdefault("SUPABASE_URL", "https://supabase.test")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")
os.environ.setdefault("GEMINI_API_KEY", "test-gemini-api-key")


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
