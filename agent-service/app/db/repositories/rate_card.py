"""rate_card_base 的唯讀存取。

**只讀不寫，也不算錢。** 費率表的寫入屬商家後台（TypeScript），計價屬
internal pricing API——本服務對 rate card 的唯一需求是「查該商家在售哪些
服務項目」，作為 subtype 的合法值域。這個界線就是不變式 I-1 的一部分。
"""

from typing import Protocol

from pydantic import BaseModel

from app.agent.fields import CaseCategory
from app.db.client import as_rows, get_client

TABLE_NAME = "rate_card_base"


class RateCardService(BaseModel):
    """商家在售的一項服務。

    unit 是**計價單位**，決定「數量 1」代表什麼。少了它，模型無法判斷
    「一組貼圖，八款」的數量是 1 還是 8——A6 實測即因此把該案例算成 8 倍價。
    單位隨商家而異（有人按組賣貼圖、有人按款賣），故只能從資料帶出來。
    """

    subtype: str
    unit: str


class SupportsFindActiveServices(Protocol):
    async def find_active_services(
        self, merchant_id: str, category: CaseCategory
    ) -> list[RateCardService]: ...


class RateCardRepository:
    """查詢商家在售的服務項目。"""

    async def find_active_services(
        self, merchant_id: str, category: CaseCategory
    ) -> list[RateCardService]:
        """取該商家該 category 目前在售（is_active）的服務項目與計價單位。

        只回在售項目——停售的服務不該被抽出來報價（沿用 TS 端
        rateCardRepository.findActiveServices 的既有語意）。
        """
        client = await get_client()
        result = (
            await client.table(TABLE_NAME)
            .select("subtype, unit")
            .eq("merchant_id", merchant_id)
            .eq("category", category)
            .eq("is_active", True)
            .execute()
        )
        return [
            RateCardService(subtype=str(row["subtype"]), unit=str(row["unit"]))
            for row in as_rows(result.data)
        ]


rate_card_repository = RateCardRepository()
