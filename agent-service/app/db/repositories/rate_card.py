"""rate_card_base 的唯讀存取。

**只讀不寫，也不算錢。** 費率表的寫入屬商家後台（TypeScript），計價屬
internal pricing API——本服務對 rate card 的唯一需求是「查該商家在售哪些
服務項目」，作為 subtype 的合法值域。這個界線就是不變式 I-1 的一部分。
"""

from typing import Protocol

from app.agent.fields import CaseCategory
from app.db.client import as_rows, get_client

TABLE_NAME = "rate_card_base"


class SupportsFindActiveSubtypes(Protocol):
    async def find_active_subtypes(self, merchant_id: str, category: CaseCategory) -> list[str]: ...


class RateCardRepository:
    """查詢商家在售的服務項目。"""

    async def find_active_subtypes(self, merchant_id: str, category: CaseCategory) -> list[str]:
        """取該商家該 category 目前在售（is_active）的子類型清單。

        只回在售項目——停售的服務不該被抽出來報價（沿用 TS 端
        rateCardRepository.findActiveSubtypes 的既有語意）。
        """
        client = await get_client()
        result = (
            await client.table(TABLE_NAME)
            .select("subtype")
            .eq("merchant_id", merchant_id)
            .eq("category", category)
            .eq("is_active", True)
            .execute()
        )
        return [str(row["subtype"]) for row in as_rows(result.data)]


rate_card_repository = RateCardRepository()
