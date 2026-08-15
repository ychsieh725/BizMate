"""統一 API 回應信封。

刻意與 TypeScript 端的 apiOk / apiFail（src/lib/api/response.ts）保持同一形狀，
讓 TS client 只需要一套解析邏輯，不必為跨服務呼叫另寫分支。
"""


def api_ok(data: object) -> dict[str, object]:
    """成功回應：data 有值、error 為 None。"""
    return {"success": True, "data": data, "error": None}


def api_fail(error: str) -> dict[str, object]:
    """失敗回應——data 恆為 None，帶面向呼叫端的訊息。"""
    return {"success": False, "data": None, "error": error}
