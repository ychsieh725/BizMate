# Domains — 業務領域邊界

依「功能/領域組織，非依類型」。每個領域高內聚、低耦合，僅透過 `shared/` 的型別契約與
`lib/` 的基礎設施互動。LLM 只出現在四個本質模糊的節點（抽取、反問、報價推理、修改解析），
其餘全部 deterministic（SAD §5 分界原則）。

| 領域目錄 | 職責 | 類型 | 對應需求 | 填入任務 |
|---|---|---|---|---|
| `intake/` | 口語文字 → 結構化欄位 + confidence + source_span | LLM (Flash-Lite) | FR-PA | 3.3 |
| `clarification/` | 缺欄位時單題反問、輪數上限、保守估價 fallback | LLM (Flash-Lite) | FR-CL | 4.1-4.2 |
| `pricing/` | 基礎費率查表 (det.) + 區間內加成判斷 + 程式層區間驗證 | LLM (Flash) + det. | FR-PR | 3.4-3.5, 4.3-4.4 |
| `line/` | Push Dispatcher、Session Router (det.)、Revision Agent、確認寄出 | LLM (Flash-Lite) + det. | FR-LN | 4.6-4.10 |
| `email/` | 最終報價單 Email 寄送 (Nodemailer + Gmail SMTP) | Deterministic | FR-EM | 4.11 |
| `eval/` | Golden set、批次評估、指標計算 | 批次腳本 | FR-EV | 5.1-5.3 |
| `finops/` | 成本記錄、模型分層、額度追蹤、預算護欄 | Deterministic | FR-FO | 4.5, 6.1-6.3 |

## 依賴方向

```
app/ (頁面 + API Routes)
  └─▶ orchestrator/ (狀態機)
        └─▶ domains/*  ─▶ lib/ (supabase, gemini, env)
                        └─▶ shared/ (types, constants)
```

上層可依賴下層，反向禁止。`shared/` 不依賴任何其他層。

> 各領域的實作檔在對應任務啟動時建立，屆時本表的「填入任務」欄即為進度依據。
