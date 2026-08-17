"""內部服務認證。

設計文件〈安全考量〉v3：Python 與 Next.js 共用 domain 不代表此服務受保護——
端點仍可被外部直接請求。故所有業務端點一律要求 shared secret，不因同域省略。
"""

import secrets

from fastapi import Header, HTTPException, status

from app.config import settings


async def require_internal_secret(
    x_internal_secret: str | None = Header(default=None),
) -> None:
    """驗證內部服務金鑰；不符即 401。

    用 secrets.compare_digest 而非 == 比對：後者會在第一個相異位元組就返回，
    洩漏「猜對了幾個字元」的時間差。這裡的輸入來自網路，值得用常數時間比對。

    錯誤訊息刻意不區分「未帶」與「不正確」，也不回傳期望值——
    避免對外洩漏認證機制的細節。
    """
    if x_internal_secret is None or not secrets.compare_digest(
        x_internal_secret, settings.internal_service_secret
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="內部服務認證失敗",
        )
