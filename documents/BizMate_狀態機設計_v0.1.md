# BizMate 狀態機設計 v0.1

**建立日期：** 2026-07-05
**對應任務：** 3.1 Orchestrator 狀態機
**對應規格：** SDS §4

> 狀態機是 session 生命週期的權威中樞——**一個純函式的通用機制**。所有推進 session
> 的流程（`/describe`、`/answer`、LINE webhook…）都呼叫它、不各自判斷狀態轉移。
> 本文件只描述這個機制本身；「誰來用它、怎麼串業務」見
> [BizMate 編排流程設計](./BizMate_編排流程設計_v0.1.md)。

---

## 1. 定位：機制，不是流程

狀態機是 `orchestrator/` 層的核心。它**只回答一件事**：「在狀態 X 遇到事件 E，能不能轉、轉到哪」。

- **純函式、無 I/O**：不讀寫 DB、不呼叫 Agent，只做狀態計算。
- **通用**：與任何具體業務流程無關；`/describe` 只是它的第一個使用者。
- **穩定契約**：這份表一旦定案，上層流程都依賴它，改動需謹慎。

```
app/ (API routes)
  └─▶ orchestrator/
        ├── stateMachine.ts  ← 本文件（機制）
        └── *Flow.ts         ← 編排流程（機制的使用者，另一份文件）
              └─▶ domains/* → lib/ → shared/
```

---

## 2. 核心設計：轉移即查表

狀態機的本質是**一張轉移表**，不是一堆 if/else：

```
TRANSITIONS[當前狀態][事件] = 下一狀態
```

`transition()` 就是一次查表 + early return，非法轉移＝查無此鍵，**無任何特殊情況分支**。
（Linus 式：用資料結構消除特殊情況。）

---

## 3. 九個狀態（SessionStatus）

| 狀態 | 說明 |
|---|---|
| `created` | 已選案件類型，停在描述輸入畫面 |
| `parsing` | Intake Parser 執行中 |
| `awaiting_clarification` | 等待客戶回答反問 |
| `pricing` | 計價中 |
| `awaiting_freelancer` | 已產報價，等接案者 LINE 終審 |
| `revising` | LINE Revision Agent 執行中 |
| `confirmed` | 接案者已確認 |
| `sent` | Email 已寄出（終態） |
| `abandoned` | 逾時/異常中止（終態） |

---

## 4. 事件（SessionEvent）

SDS §4.2 的複合跳轉「`revising`→`confirmed`→`sent`」拆成兩個單一事件
（`revision_confirmed`、`email_sent`），使每筆轉移都是「一狀態 + 一事件 → 一狀態」，
無複合跳轉。

---

## 5. 轉移表

| 當前狀態 | 事件 | 下一狀態 |
|---|---|---|
| `created` | `describe_submitted` | `parsing` |
| `created` | `timeout` | `abandoned` |
| `parsing` | `parse_incomplete` | `awaiting_clarification` |
| `parsing` | `parse_complete` | `pricing` |
| `awaiting_clarification` | `answer_submitted` | `parsing` |
| `awaiting_clarification` | `clarification_exhausted` | `pricing` |
| `awaiting_clarification` | `timeout` | `abandoned` |
| `pricing` | `pricing_done` | `awaiting_freelancer` |
| `awaiting_freelancer` | `line_received` | `revising` |
| `awaiting_freelancer` | `timeout` | `abandoned` |
| `revising` | `revision_applied` | `awaiting_freelancer` |
| `revising` | `revision_confirmed` | `confirmed` |
| `confirmed` | `email_sent` | `sent` |

- **終態** `sent`、`abandoned` 無出邊。
- **`timeout` 不寫成特例**：三個等待狀態（`created`、`awaiting_clarification`、
  `awaiting_freelancer`）各自在表中明列 `timeout → abandoned`，「哪些狀態可逾時」
  由資料本身表達，而非藏在程式邏輯。

---

## 6. API

| 函式 | 用途 |
|---|---|
| `transition(state, event)` | 回 `{ ok: true, state }` 或 `{ ok: false, error }` |
| `canTransition(state, event)` | 是否為合法轉移（守門用） |
| `isTerminalState(state)` | 是否終態 |
| `availableEvents(state)` | 該狀態所有合法事件 |

**Result 型別而非 throw**：狀態機不以例外控制流程，讓呼叫端（編排層/API）型別安全分流。

---

## 7. 相關檔案

| 檔案 | 角色 |
|---|---|
| [`stateMachine.ts`](../src/orchestrator/stateMachine.ts) | 狀態機 API（純函式 + Result） |
| [`transitions.ts`](../src/orchestrator/transitions.ts) | 轉移表（單一事實來源） |
| [`events.ts`](../src/orchestrator/events.ts) | 事件型別 |

使用狀態機的編排流程見 [BizMate 編排流程設計](./BizMate_編排流程設計_v0.1.md)。
