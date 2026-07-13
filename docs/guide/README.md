# BizMate 新手導讀

> 寫給第一次接觸這個專案、程式經驗還不多的工程師。目標：讓你在動手改任何程式碼之前，先知道「這個系統在做什麼、程式碼放在哪、資料怎麼流」。

## 這個專案是什麼？

**BizMate 是一個「自動報價」的多租戶 SaaS。**

用一句話描述使用情境：

> 接案的插畫師小陳註冊 BizMate、設定好自己的價目表，拿到專屬連結 `/q/chen-studio` 傳給客戶。客戶點開連結，用口語打一段「幫我畫一個角色，要商用、三天內交件」，系統用 AI 解析需求、自動算出報價。小陳在後台看到這筆待審報價，確認金額沒問題後按下確認、寄出——客戶信箱就收到正式報價單。

系統裡有兩種人：

| 角色 | 誰 | 用哪些頁面 |
|---|---|---|
| **商家（merchant）** | 接案者本人，需要註冊登入 | `/login`、`/signup`、`/onboarding`、`/dashboard/**` |
| **客戶（customer）** | 商家的客戶，**完全匿名、不用註冊** | 只用 `/q/{slug}` 這一頁 |

「多租戶（multi-tenant）」的意思是：很多商家共用同一套系統、同一個資料庫，但彼此的資料**絕對不能互相看見**。這是整個專案最重要的架構約束，很多程式碼的寫法都是為了保證這件事（詳見 [04-patterns.md](04-patterns.md) 的租戶隔離章節）。

## 技術棧

| 層 | 技術 | 在專案裡的角色 |
|---|---|---|
| 前端 + 後端 | **Next.js 16**（App Router） | 頁面和 API 都在同一個專案裡，部署目標是 Vercel Serverless |
| 資料庫 + 登入 | **Supabase**（PostgreSQL + Auth） | 存所有資料；商家的註冊登入直接用 Supabase Auth |
| AI 解析 | **Gemini API** | 把客戶的口語描述解析成結構化欄位（例如抽出「數量=1」「授權=商用」） |
| 寄信 | **Resend** | 把最終報價單寄到客戶信箱 |
| 語言 / 樣式 | TypeScript / Tailwind CSS v4 | 全專案都是 TypeScript，禁用 `any` |
| 驗證 | **zod** | 所有外部輸入（API body、環境變數、AI 回傳）都先過 zod 才使用 |

## 怎麼在本機跑起來？

```bash
# 環境：macOS / Linux，Node.js 20+，pnpm
pnpm install            # 安裝依賴
pnpm dev                # 啟動開發伺服器 → http://localhost:3000
pnpm test               # 跑全部單元測試（vitest）
pnpm build              # 產生正式版建置（同時做 TypeScript 型別檢查）
pnpm lint               # ESLint
```

需要一個 `.env.local`（不在 git 裡，跟團隊拿）。裡面是 Supabase / Gemini / Resend 的金鑰。啟動時 [`src/lib/env.ts`](../../src/lib/env.ts) 會用 zod 檢查每一項都存在且格式正確，缺任何一項會**直接啟動失敗**並告訴你缺哪個——這是刻意設計（fail-fast），避免跑到一半才發現金鑰沒設。

## 這份導讀怎麼讀？

依序讀完四份，大約需要一個下午：

| 順序 | 文件 | 回答的問題 |
|---|---|---|
| 1 | [01-big-picture.md](01-big-picture.md) | 整個系統的資料流是什麼？一筆報價從出生到寄出經過哪些狀態？ |
| 2 | [02-code-map.md](02-code-map.md) | 程式碼目錄怎麼分區？我想改某個功能該去哪個資料夾？ |
| 3 | [03-follow-a-quote.md](03-follow-a-quote.md) | 拿一筆真實報價當主角，逐行追蹤程式碼怎麼接力處理它 |
| 4 | [04-patterns.md](04-patterns.md) | 全專案反覆出現的寫法慣例（分層、信封、狀態機、租戶隔離）——看懂這些，任何檔案都讀得懂 |
| 5 | [05-dev-workflow.md](05-dev-workflow.md) | 測試怎麼跑？verify 腳本是什麼？資料庫 migration 怎麼套？ |

**建議的讀碼起點**：讀完文件後，從 [`src/orchestrator/transitions.ts`](../../src/orchestrator/transitions.ts) 開始看——它只有 40 行，卻是整個系統的骨架（狀態轉移表）。看懂它，其他程式碼都是在這張表上掛肉。
