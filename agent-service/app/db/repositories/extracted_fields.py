"""extracted_fields 的讀寫。

agent 每次 record_fields 都會 upsert 進這張表，因此它同時是「agent 的工作
記憶」與「fallback 的輸入」——loop 若中途放棄，TypeScript 端的
resolveAfterParse 會拿這裡已寫入的欄位接手（不變式 I-3）。

這也是為什麼欄位要即時寫入而非留在記憶體：agent 走了幾步的成果必須能被
繼承，否則 fallback 就等於從頭來過。
"""

from typing import Protocol

from app.agent.fields import FieldExtraction
from app.db.client import as_rows, get_client

TABLE_NAME = "extracted_fields"

# 與 migration 0001 的唯一鍵一致：同一 session 的同名欄位只有一筆。
CONFLICT_TARGET = "session_id,field_name"


class SupportsFieldStorage(Protocol):
    async def upsert_many(self, session_id: str, fields: dict[str, FieldExtraction]) -> None: ...

    async def find_by_session(self, session_id: str) -> dict[str, FieldExtraction]: ...


class ExtractedFieldsRepository:
    """讀寫某 session 的抽取欄位。"""

    async def upsert_many(self, session_id: str, fields: dict[str, FieldExtraction]) -> None:
        """寫入或覆蓋多個欄位。

        用 upsert 而非 insert：agent 可能在後續步驟修正先前的抽取值
        （例如反問後拿到更精確的答案），同名欄位應覆蓋而非累積。
        """
        if not fields:
            return

        payload = [
            {
                "session_id": session_id,
                "field_name": name,
                "value": field.value,
                "confidence": field.confidence,
                "source_span": field.source_span,
            }
            for name, field in fields.items()
        ]
        client = await get_client()
        await client.table(TABLE_NAME).upsert(payload, on_conflict=CONFLICT_TARGET).execute()

    async def find_by_session(self, session_id: str) -> dict[str, FieldExtraction]:
        """取回某 session 目前已記錄的所有欄位。"""
        client = await get_client()
        result = (
            await client.table(TABLE_NAME)
            .select("field_name, value, confidence, source_span")
            .eq("session_id", session_id)
            .execute()
        )
        return {
            str(row["field_name"]): FieldExtraction(
                value=row["value"],
                confidence=float(row["confidence"]),
                source_span=row["source_span"],
            )
            for row in as_rows(result.data)
        }


extracted_fields_repository = ExtractedFieldsRepository()
