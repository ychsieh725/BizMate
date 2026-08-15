"""服務設定。

對應 TypeScript 端的 src/lib/env.ts：在載入階段驗證必要秘密，缺漏即 fail-fast。
理由同 security.md——設定錯誤要在部署時就炸，而不是等使用者送出第一筆請求
才在執行期出錯。
"""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# 低於此長度的 secret 不具防護力，視為設定錯誤。
MIN_SECRET_LENGTH = 16


class Settings(BaseSettings):
    """由環境變數載入的服務設定。

    欄位名為小寫，pydantic-settings 會以大小寫不敏感的方式對應到
    INTERNAL_SERVICE_SECRET 等環境變數。
    """

    model_config = SettingsConfigDict(
        env_file=".env.local",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # 內部服務認證：Next.js ↔ agent-service 雙向共用。
    # 同域不等於受保護，此值是唯一的防線（設計文件〈安全考量〉v3）。
    internal_service_secret: str = Field(min_length=MIN_SECRET_LENGTH)

    # Supabase（A1 起）：軌跡與成本寫入。
    # 與 TS 端 env.ts 同列為「核心」——缺了就無法記錄任何觀測資料，
    # 應在部署時就炸，而不是等第一個 agent loop 跑到一半才發現寫不進去。
    supabase_url: str = Field(min_length=1)
    supabase_service_role_key: str = Field(min_length=1)

    # Gemini（A2 起）：AI 層的唯一模型供應者，缺了整個服務無事可做。
    gemini_api_key: str = Field(min_length=1)

    # 服務識別，供 /health 與 echo 回報；有預設值故不需逐環境設定。
    service_name: str = "agent-service"
    service_version: str = "0.1.0"


def load_settings() -> Settings:
    """建立設定實例。設定不合法時拋出 ValidationError（fail-fast）。"""
    return Settings()  # type: ignore[call-arg]


settings = load_settings()
