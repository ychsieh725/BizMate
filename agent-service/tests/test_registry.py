"""Tool 註冊表。

registry 的價值在於「宣告」與「派發」從同一份資料衍生，不會漂移——
不會出現宣告給模型卻沒實作的 tool，也不會有實作了卻模型看不到的 tool。
"""

from app.agent.registry import build_registry, declarations_for, default_tools

EXPECTED_TOOLS = {
    "lookup_rate_card",
    "record_fields",
    "ask_customer",
    "compute_quote",
}


def test_registry_contains_all_four_tools():
    registry = build_registry()

    assert set(registry) == EXPECTED_TOOLS


def test_registry_keys_match_tool_names():
    registry = build_registry()

    assert all(name == tool.name for name, tool in registry.items())


def test_declarations_cover_every_registered_tool():
    """宣告與派發不得漂移：模型看得到的，執行端就要能派發。"""
    registry = build_registry()

    declared = {declaration.name for declaration in declarations_for(registry)}

    assert declared == set(registry)


def test_declaration_order_is_stable():
    """宣告順序會影響模型的選擇傾向；順序不穩會讓 eval 產生無法歸因的變異。"""
    first = [d.name for d in declarations_for(build_registry())]
    second = [d.name for d in declarations_for(build_registry())]

    assert first == second


def test_every_declaration_has_description():
    """模型靠 description 決定何時用哪個 tool，缺了等於閉眼選。"""
    for declaration in declarations_for(build_registry()):
        assert declaration.description


def test_registry_accepts_injected_tools():
    """讓 loop 的測試能裝入假 tool。"""
    only_lookup = [tool for tool in default_tools() if tool.name == "lookup_rate_card"]

    registry = build_registry(only_lookup)

    assert set(registry) == {"lookup_rate_card"}


def test_terminal_and_query_tools_both_present():
    """兩類都要有：只有查詢類的 loop 永遠不會結束。"""
    kinds = {tool.kind for tool in build_registry().values()}

    assert kinds == {"query", "terminal"}
