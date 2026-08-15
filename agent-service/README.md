# agent-service

BizMate 的 AI 層。tool-calling agent、parser、clarification 與 eval 都住在這裡。

對應設計文件：[`docs/superpowers/specs/2026-08-15-tool-calling-agent-design.md`](../docs/superpowers/specs/2026-08-15-tool-calling-agent-design.md)

## 現況：A0（骨架）

只有兩個端點，都還沒有業務邏輯：

| 端點 | 認證 | 用途 |
| :--- | :--- | :--- |
| `GET /health` | 公開 | 探活。刻意不回傳任何設定值 |
| `POST /agent/echo` | 需 secret | 證明 TS → Python 呼叫鏈打通；A3 起由 `/agent/resolve` 取代 |

## 為什麼計價不在這裡

不變式 **I-1**：金額計算留在 TypeScript 服務內，本服務只能透過
`POST /api/internal/pricing/compute` 取得結果。agent 在架構上沒有能力修改計價
程式碼或金額——這是刻意的邊界，不是尚未搬移。**請勿把 pricing 邏輯搬進來。**

## 本機開發

```bash
# 安裝相依（會建立 .venv）
uv sync

# 啟動（需先設好 secret，至少 16 字元）
export INTERNAL_SERVICE_SECRET="$(openssl rand -base64 32)"
uv run uvicorn app.main:app --reload --port 8000
```

Next.js 端對應設定 `.env.local`：

```
AGENT_SERVICE_URL=http://127.0.0.1:8000
INTERNAL_SERVICE_SECRET=<與上面同一個值>
```

> 兩邊 secret 不一致會得到 401；未設定則 TS 端回 `not_configured` 並
> fallback 到既有流程（不變式 I-3），系統不會壞掉。

## 品質閘門

與 CI 的 `python-quality` job 一致：

```bash
uv run ruff check .          # lint
uv run ruff format --check . # 格式
uv run mypy app              # 型別（strict）
uv run pytest                # 測試 + 80% 覆蓋率門檻
```

## 部署

不獨立部署。透過根目錄 [`vercel.json`](../vercel.json) 的 `experimentalServices`
與 Next.js 共存於同一個 Vercel project，掛在 `/agent-service` 路徑前綴下。

`eval/`、`tests/` 已由 `functions.excludeFiles` 排除於 function bundle 之外——
Python 無自動 tree-shaking，統計分析相依（pandas/scipy）若被打包會白吃額度。

部署步驟與「拆成兩個 project」的退路見 [`docs/deployment.md`](../docs/deployment.md)。
