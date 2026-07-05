# BizMate 編排流程設計 v0.1

**建立日期：** 2026-07-05
**對應規格：** SDS §5.1（Wizard API）、SDS §6（Agent）、SDS §12（錯誤處理）

> 編排流程是**狀態機的使用者**——把[狀態機](./BizMate_狀態機設計_v0.1.md)（機制）、
> Agent、報價鏈、持久化串成一個具體的業務流程。狀態機負責「能不能轉、轉到哪」，
> 編排負責「這一步該做什麼 I/O、失敗怎麼辦」。
>
> 目前只有 `/describe` 一個編排；隨 P1 展開會陸續加入 `/answer`、LINE webhook 等
> （見 §4）。它們共同的特徵：都呼叫 `transition()` 推進狀態，但各自串不同的領域邏輯。

---

## 1. 定位：機制 vs 用例

| | 狀態機（機制） | 編排流程（用例） |
|---|---|---|
| 職責 | 狀態能不能轉、轉到哪 | 這一步做什麼 I/O、串哪些領域、失敗怎麼辦 |
| I/O | 無（純函式） | 有（DB、Agent、報價鏈） |
| 數量 | 一個 | 多個（每個使用者流程一個） |
| 檔案 | `stateMachine.ts` | `*Flow.ts` |

一句話：**狀態機是引擎，編排是踩油門的人。**

---

## 2. `/describe` 編排（`orchestrator/describeFlow.ts`）

第一個編排流程，對應 Wizard Step 2（客戶送出口語描述）。

### 2.1 流程

```
POST /describe
  1. 載入 session ───────────────── 查無 → not_found (404)
  2. canTransition(status, describe_submitted)? ── 否 → conflict (409，已描述過)
  3. 寫 raw_inputs + 更新 contact_email
  4. transition: created → parsing（寫 status）
  5. parseIntake(category, rawText) → 抽取欄位
  6. upsert extracted_fields（每欄一列）
  7. 分兩路：
     ├─ 缺欄位 → parse_incomplete → awaiting_clarification
     │            回 { status, missing_fields }
     └─ 齊全   → parse_complete → pricing
                  → computeBasePricing → generateQuoteCode
                  → 寫 quotes + price_line_items
                  → pricing_done → awaiting_freelancer
                  回 { status, quote_code, out_of_scope }
```

### 2.2 兩條路徑

| 路徑 | 觸發 | 終狀態 | 回應 |
|---|---|---|---|
| 缺欄位 | `missingRequiredFields` 非空 | `awaiting_clarification` | `missing_fields`（`question` 由 4.1 Clarification 補；P0 只回缺漏清單） |
| 齊全 | 無缺漏 | `awaiting_freelancer` | `quote_code`、`out_of_scope` |

### 2.3 out_of_scope 處理（SDS §12）

查無 `rate_card_base` 子類型時，計價回 `outOfScope`。此時**仍寫入 quote 並進
`awaiting_freelancer`**，只是 `final_amount = null`、預覽標示「需人工評估」——不虛構金額，
交由接案者人工處理（FR-PR-3）。

### 2.4 狀態機作為守門員

`canTransition(status, describe_submitted)` 擋掉「非 `created` 狀態的重複 describe」，回 409。
流程內其餘轉移皆為已知合法，非法即代表程式內部不變量被破壞（直接 throw）。

---

## 3. 已知限制（P0，待後續強化）

| 限制 | 說明 | 未來處理 |
|---|---|---|
| **非原子** | 一次 describe 有多筆寫入（raw_input→status→fields→quotes→items），不做分散式事務，中途失敗會留部分資料 | 評估以 Supabase RPC 包成單一事務 |
| **失敗停在中間狀態** | Parser/計價拋錯 → route 回 500，session 停在 `parsing`/`pricing`（狀態機無回退邊） | 靠 `timeout → abandoned` 回收（SDS §12） |
| **`question` 未生成** | 缺欄位路徑只回 `missing_fields`，無自然語言反問 | 4.1 Clarification Agent |
| **區間加成未計** | 計價只含基礎費 + 固定倍率 modifier | 4.3 Pricing Reasoning Agent |

---

## 4. 未來編排（P1 展開）

以下流程都會是新的 `*Flow.ts`，共用同一個狀態機：

| 編排 | 觸發事件 | 對應任務 |
|---|---|---|
| `/answer` 反問回答 | `answer_submitted`（重新抽取）/ `clarification_exhausted`（保守估價） | 4.2 |
| LINE webhook 收訊 | `line_received` → `revising` | 4.6–4.7 |
| Revision 套用 | `revision_applied`（迴圈）/ `revision_confirmed` | 4.9 |
| 確認寄出 | `email_sent` → `sent` | 4.10–4.11 |

---

## 5. 相關檔案

| 檔案 | 角色 |
|---|---|
| [`describeFlow.ts`](../src/orchestrator/describeFlow.ts) | `/describe` 編排 |
| [`describe/route.ts`](../src/app/api/sessions/[id]/describe/route.ts) | HTTP 端點（薄層） |

機制本身見 [BizMate 狀態機設計](./BizMate_狀態機設計_v0.1.md)；測試策略見 [BizMate 測試指南](./BizMate_測試指南_v0.1.md)。
