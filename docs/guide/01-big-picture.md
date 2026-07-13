# 01 · 全局視角：資料怎麼流

> 這一章不看程式碼細節，只建立心智模型：兩種使用者各自的旅程、以及貫穿全系統的「session 狀態機」。

## 兩條使用者旅程

### 旅程 A：商家（一次性設定）

```
註冊 /signup
   │  （Supabase Auth 建立帳號）
   ▼
onboarding /onboarding
   │  （建立 merchants 資料列、自動產生專屬 slug、
   │    從「範本價目表」複製一份給這個商家）
   ▼
後台 /dashboard
   ├── /dashboard/services   改自己的價目表（單價、包含項目）
   ├── /dashboard/settings   改商家名稱、slug
   └── 複製分享連結 /q/{slug} → 傳給客戶
```

關鍵概念：**每個商家有自己的一份價目表**（`rate_card_base` + `rate_card_modifiers`）。onboarding 時從全域範本表複製一份初始值，之後商家自己改。改完之後，新的報價立刻用新價格——因為計價時是即時查該商家的表。

### 旅程 B：客戶報價（每筆報價一次）

```
客戶打開 /q/{slug}                        ← slug 決定這筆報價屬於哪個商家
   │
   ▼ Step 1 選類別（插畫 / 平面設計 / 網站設計）
POST /api/sessions                        → 建立一筆 session（狀態: created）
   │
   ▼ Step 2 口語描述需求 + 留 email
POST /api/sessions/{id}/describe
   │  1. 狀態 created → parsing
   │  2. 呼叫 Gemini 抽取結構化欄位（數量、授權範圍…）
   │  3. 依抽取結果分三條路（見下方狀態機）
   ▼
 ┌─────────────────┬──────────────────────┐
 │ 資訊齊全          │ 資訊不足              │
 │                 │                      │
 ▼                 ▼                      │
直接計價        反問一題（最多 3 輪）        │
 │             POST /answer 回答後重新解析──┘
 │             （3 輪用完還缺 → 用現有資訊「保守估算」）
 ▼
產出報價（狀態: awaiting_review）
   │
   ▼ 客戶端畫面顯示「報價單編號 I-2607001，等待商家確認」
   │   （前端每隔幾秒 GET /status 輪詢狀態）
   │
   ▼ ——以下輪到商家在後台操作——
商家在 /dashboard/quotes 看到這筆待審報價
   ├── （可選）調整金額 PATCH /api/dashboard/quotes/{id}
   ├── 確認 POST /api/dashboard/quotes/{id}/confirm   → 狀態: confirmed
   └── 寄送 POST /api/dashboard/quotes/{id}/send      → 真的寄 email → 狀態: sent
```

## 系統的心臟：session 狀態機

每筆客戶報價流程對應資料庫裡的一筆 `sessions`，它的 `status` 欄位只能是以下八個值之一，而且**只能沿著固定的路線走**：

```
created ──describe_submitted──▶ parsing
                                   │
              ┌────parse_incomplete┴──parse_complete────┐
              ▼                                         ▼
   awaiting_clarification ──clarification_exhausted──▶ pricing
              │        ▲                                 │
   answer_submitted    │                            pricing_done
              └──▶ parsing（重新解析）                    ▼
                                                  awaiting_review
                                                        │
                                                  quote_confirmed
                                                        ▼
                                                    confirmed
                                                        │
                                                    email_sent
                                                        ▼
                                                      sent（終態）

（created / awaiting_clarification / awaiting_review 三個「等待中」狀態
  另有 timeout ──▶ abandoned（終態），目前尚未實作自動逾時，保留設計）
```

這張圖的程式碼版本就是 [`src/orchestrator/transitions.ts`](../../src/orchestrator/transitions.ts) 的 `TRANSITIONS` 表——**一個巢狀物件，`表[現在狀態][發生的事件] = 下一個狀態`**：

```ts
export const TRANSITIONS = {
  created: {
    describe_submitted: "parsing",
    timeout: "abandoned",
  },
  parsing: {
    parse_incomplete: "awaiting_clarification",
    parse_complete: "pricing",
  },
  // ...
};
```

為什麼用「查表」而不是一堆 if/else？因為**非法操作會自動變成「查無此鍵」**。例如客戶對同一個 session 重複送出描述：第二次時狀態已是 `parsing`，而 `TRANSITIONS.parsing` 裡沒有 `describe_submitted` 這個鍵 → 查表失敗 → API 回 409 Conflict。不需要寫任何「如果已經描述過就擋下」的特殊判斷，資料結構本身就把規則表達完了。

`quotes` 表（報價單）另外有一個較簡單的四態 `status`（`draft` → `awaiting_review` → `confirmed` → `sent`），它和 session 的狀態**必須同步推進**——這件事由資料庫裡的原子 RPC 保證（見 [04-patterns.md](04-patterns.md)）。

## 三個「等待狀態」是三個暫停點

理解狀態機的一個訣竅：流程不是一口氣跑完的，它會在三個地方**停下來等人**：

| 停在哪                     | 在等誰         | 等什麼動作                               |
| -------------------------- | -------------- | ---------------------------------------- |
| `created`                | 客戶           | 送出需求描述                             |
| `awaiting_clarification` | 客戶           | 回答系統的反問（例如「請問需要幾頁？」） |
| `awaiting_review`        | **商家** | 在後台審核、確認這筆報價                 |

前兩個暫停點的「繼續」按鈕在客戶手上（公開 API），第三個在商家手上（需登入的後台 API）。這也解釋了為什麼 API 分成兩組：`/api/sessions/**`（公開、匿名、有速率限制）和 `/api/dashboard/**`（要登入、要驗證商家身分）。

## 錢從哪裡算出來？

報價金額不是 AI 決定的——**AI 只負責「讀懂客戶要什麼」，算錢是純程式邏輯**（deterministic，同樣輸入永遠得到同樣輸出）：

```
Gemini 抽取欄位（subtype=角色設計、quantity=1、license_scope=商業使用）
        │
        ▼
查這個商家的價目表 rate_card_base（角色設計 → 單價 6000）
        │
        ▼
基本費 = 單價 × 數量 = 6000
        │
        ▼
檢查加成規則 rate_card_modifiers（商業使用 → +40%）
        │
        ▼
明細：[角色設計基本費 6000] + [商業使用加成 2400] = 總價 8400
```

每一行明細都記錄它引用了價目表的哪一條規則（`rule_id` / `modifier_id`），所以任何一筆報價都能回答「這個數字是怎麼來的」——這叫**可回溯性**，是本專案的核心產品主張。實作在 [`src/domains/pricing/basePricing.ts`](../../src/domains/pricing/basePricing.ts)，不到 110 行，值得一讀。

## 下一步

看 [02-code-map.md](02-code-map.md)，把這章的概念對應到實際的目錄與檔案。
