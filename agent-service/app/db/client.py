"""Supabase client（service_role）。

對應 TypeScript 端的 src/lib/supabase/client.ts：以 service_role 金鑰連線，
繞過 RLS。所有表都是 deny-by-default，伺服器端一律以此角色存取。

刻意延後建立（lazy）：import 本模組不應觸發網路或連線設定，
否則單元測試與 Vercel 的冷啟動都會白付代價。
"""

from supabase import AsyncClient, create_async_client

from app.config import settings

_client: AsyncClient | None = None


async def get_client() -> AsyncClient:
    """取得共用的 Supabase client；首次呼叫時才建立。"""
    global _client
    if _client is None:
        _client = await create_async_client(
            settings.supabase_url, settings.supabase_service_role_key
        )
    return _client
