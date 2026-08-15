"""設定載入。

對應 TS 端 src/lib/env.ts 的 fail-fast 策略（security.md「啟動時驗證必要
秘密存在」）：缺少必要變數時在載入階段就炸掉，而非等到第一個請求進來才
在執行期出錯。
"""

import pytest
from pydantic import ValidationError

from app.config import Settings


def test_missing_secret_fails_fast(monkeypatch):
    """缺少 INTERNAL_SERVICE_SECRET → 載入即失敗。

    conftest 為了讓其他測試能建立 app，已在 process 層設好該變數；
    此處須明確移除才能重現「部署時忘記設定」的真實情境。
    """
    monkeypatch.delenv("INTERNAL_SERVICE_SECRET", raising=False)

    with pytest.raises(ValidationError):
        Settings(_env_file=None)  # type: ignore[call-arg]


def test_blank_secret_is_rejected():
    """空字串視同未設定——.env 留白是常見的部署疏漏。"""
    with pytest.raises(ValidationError):
        Settings(_env_file=None, internal_service_secret="")  # type: ignore[call-arg]


def test_short_secret_is_rejected():
    """過短的 secret 不具防護力，直接擋在設定層。"""
    with pytest.raises(ValidationError):
        Settings(_env_file=None, internal_service_secret="short")  # type: ignore[call-arg]


def test_valid_secret_loads():
    """合法設定可正常載入。"""
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None, internal_service_secret="a-sufficiently-long-secret"
    )

    assert settings.internal_service_secret == "a-sufficiently-long-secret"


def test_service_name_has_default():
    """服務識別有預設值，不需在每個環境重複設定。"""
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None, internal_service_secret="a-sufficiently-long-secret"
    )

    assert settings.service_name == "agent-service"
