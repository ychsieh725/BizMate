"""Supabase client（service_role）。

對應 TypeScript 端的 src/lib/supabase/client.ts：以 service_role 金鑰連線，
繞過 RLS。所有表都是 deny-by-default，伺服器端一律以此角色存取。

刻意延後建立（lazy）：import 本模組不應觸發網路或連線設定，
否則單元測試與 Vercel 的冷啟動都會白付代價。
"""

from typing import Any, cast

from supabase import AsyncClient, create_async_client

from app.config import settings

type Row = dict[str, Any]

_client: AsyncClient | None = None


def as_rows(data: object) -> list[Row]:
    """把 postgrest 的回傳轉成可用字串索引的列。

    postgrest 宣告回傳 Sequence[JSON]，型別上不允許 row["id"]。在此做一次
    明確轉型，而非在每個取值點灑 type: ignore——對資料形狀的假設集中在一處。
    """
    return cast(list[Row], data or [])


async def get_client() -> AsyncClient:
    """取得共用的 Supabase client；首次呼叫時才建立。"""
    global _client
    if _client is None:
        _client = await create_async_client(
            settings.supabase_url, settings.supabase_service_role_key
        )
    return _client
