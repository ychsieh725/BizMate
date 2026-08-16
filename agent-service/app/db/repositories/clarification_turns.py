"""clarification_turns 的寫入。

每一題反問都留一筆，round 標記它屬於第幾輪。同一輪的多題共用 round 號
（表上對 round 無唯一約束），沿用 TS 端 resolveAfterParse 的既有做法。
"""

from typing import Protocol

from app.db.client import get_client

TABLE_NAME = "clarification_turns"


class ClarificationItem(Protocol):
    question: str
    target_field: str


class SupportsCreateMany(Protocol):
    async def create_many(
        self, session_id: str, round_number: int, items: list[tuple[str, str]]
    ) -> None: ...


class ClarificationTurnsRepository:
    """寫入反問紀錄。"""

    async def create_many(
        self, session_id: str, round_number: int, items: list[tuple[str, str]]
    ) -> None:
        """寫入本輪的所有問題。items 為 (target_field, question) 的序列。"""
        if not items:
            return

        payload: list[dict[str, str | int]] = [
            {
                "session_id": session_id,
                "round": round_number,
                "question": question,
                "triggered_field": target_field,
            }
            for target_field, question in items
        ]
        client = await get_client()
        await client.table(TABLE_NAME).insert(payload).execute()


clarification_turns_repository = ClarificationTurnsRepository()
