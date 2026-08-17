"""Agent 專屬的 4 項指標（設計文件〈Trajectory Eval〉）。

現行 11 項指標量的是**單步輸出品質**。agent 化後多出一種全新的失效模式：
「結果對」但「路徑荒謬」——繞 7 步、重複查 3 次 rate card、在無效迴圈裡打轉，
而最終欄位仍然抽對。既有指標對此完全盲目。

── tool_sequence_match_rate 的比對規則（設計文件〈待確認事項〉#4 定案）──

**忽略查詢類 tool 的連續重複，其餘嚴格比對順序。**

理由是避免同一個缺陷被兩個指標重複計價。連續呼叫兩次 lookup_rate_card 確實
是浪費，但那正是 redundant_call_rate 在量的東西；若序列比對也因此判為不符，
一次失誤會同時打低兩項指標，看報告的人無從判斷是一個問題還是兩個問題。

只收合**連續**重複而非全部去重：先查值域、記錄欄位、發現值不合再查一次，
是合理的修正行為；查 → 記錄 → 查 → 記錄 的來回打轉才是問題，而那不會被收合。

終止類 tool 不收合——它呼叫即結束 loop，不可能連續出現兩次。
"""

from collections.abc import Sequence

from app.agent.budget import call_fingerprint
from app.agent.registry import build_registry
from eval.metrics import average, safe_ratio
from eval.outcomes import ToolCallRecord, TrajectoryMetrics, TrajectoryOutcome


def query_tool_names() -> frozenset[str]:
    """查詢類 tool 的名稱集合。

    從 registry 取而非另寫一份清單：tool 的 kind 已經是 registry 的事實，
    在這裡重列一次就多一個會漂移的地方。
    """
    return frozenset(name for name, tool in build_registry().items() if tool.kind == "query")


def canonical_sequence(
    calls: Sequence[ToolCallRecord],
    query_tools: frozenset[str] | None = None,
) -> list[str]:
    """收合查詢類 tool 的連續重複，得到可比對的序列。"""
    queries = query_tools if query_tools is not None else query_tool_names()
    canonical: list[str] = []
    for call in calls:
        if canonical and call.tool_name == canonical[-1] and call.tool_name in queries:
            continue
        canonical.append(call.tool_name)
    return canonical


def sequence_matches(
    trajectory: TrajectoryOutcome,
    query_tools: frozenset[str] | None = None,
) -> bool:
    """這則的實際軌跡是否走對路。"""
    return canonical_sequence(trajectory.calls, query_tools) == trajectory.expected_sequence


def redundant_calls(calls: Sequence[ToolCallRecord]) -> int:
    """相同 tool + 相同參數的重複呼叫次數。

    以「同一指紋出現的次數減一」累計，而非只看相鄰——中間隔了別的呼叫再繞回來
    同樣是原地打轉，只看相鄰會漏掉 A→B→A 這種來回。指紋定義與 loop 的迴圈
    偵測共用（call_fingerprint），兩處對「同一次呼叫」的認定必然一致。
    """
    seen: dict[str, int] = {}
    for call in calls:
        fingerprint = call_fingerprint(call.tool_name, call.args)
        seen[fingerprint] = seen.get(fingerprint, 0) + 1
    return sum(count - 1 for count in seen.values())


def trajectory_proportion_counts(
    trajectories: Sequence[TrajectoryOutcome],
) -> dict[str, tuple[int, int]]:
    """比例型軌跡指標的 (分子, 分母)，供統計層計算信賴區間。

    avg_steps_per_case 不在此——它是連續量的平均，不是比例。
    """
    queries = query_tool_names()
    total = len(trajectories)

    return {
        "tool_sequence_match_rate": (
            sum(1 for item in trajectories if sequence_matches(item, queries)),
            total,
        ),
        "redundant_call_rate": (
            sum(redundant_calls(item.calls) for item in trajectories),
            sum(len(item.calls) for item in trajectories),
        ),
        # 基準線應為 0%：agent 只要有一則交棒，就代表它在正常輸入下不可靠
        "fallback_rate": (
            sum(1 for item in trajectories if item.outcome == "fallback"),
            total,
        ),
    }


def compute_trajectory_metrics(
    trajectories: Sequence[TrajectoryOutcome],
) -> TrajectoryMetrics:
    """聚合一批軌跡為 4 項指標。"""
    counts = trajectory_proportion_counts(trajectories)

    def ratio(name: str) -> float | None:
        numerator, denominator = counts[name]
        return safe_ratio(numerator, denominator)

    return TrajectoryMetrics(
        tool_sequence_match_rate=ratio("tool_sequence_match_rate"),
        avg_steps_per_case=average([float(item.steps_taken) for item in trajectories]),
        redundant_call_rate=ratio("redundant_call_rate"),
        fallback_rate=ratio("fallback_rate"),
    )
