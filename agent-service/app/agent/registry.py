"""Tool 註冊表。

名稱 → tool 的查表，取代 if/elif 鏈。新增 tool 只要在此登記一次，
宣告（送給模型）與派發（執行）就同步生效——兩者從同一份資料衍生，
不會出現「宣告了卻沒實作」或「實作了卻沒宣告」的漂移。
"""

from google.genai import types

from app.agent.tools.ask_customer import AskCustomerTool
from app.agent.tools.base import Tool
from app.agent.tools.compute_quote import ComputeQuoteTool
from app.agent.tools.lookup_rate_card import LookupRateCardTool
from app.agent.tools.record_fields import RecordFieldsTool


def build_registry(tools: list[Tool] | None = None) -> dict[str, Tool]:
    """建立 tool 查表。未指定時使用預設的四個 tool。"""
    resolved = tools if tools is not None else default_tools()
    return {tool.name: tool for tool in resolved}


def default_tools() -> list[Tool]:
    """A3 的四個 tool：兩個查詢類、兩個終止類。"""
    return [
        LookupRateCardTool(),
        RecordFieldsTool(),
        AskCustomerTool(),
        ComputeQuoteTool(),
    ]


def declarations_for(registry: dict[str, Tool]) -> list[types.FunctionDeclaration]:
    """取出要送給模型的 function declarations。

    順序固定依註冊順序，讓同一份 golden set 的多次執行可比較——
    宣告順序會影響模型的選擇傾向，隨機順序會讓 eval 產生無法歸因的變異。
    """
    return [tool.declaration for tool in registry.values()]
