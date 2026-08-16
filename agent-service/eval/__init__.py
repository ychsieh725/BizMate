"""Trajectory Eval（A5）。

**離線執行，不進 Vercel function bundle**（`vercel.json` 的 `excludeFiles` 排除
整個 eval/）。這裡的程式碼只在人手動或 CI 跑 eval 時載入，服務執行期碰不到。

分層與 TypeScript 端一致，讓兩個 runner 的輸出可以直接對照（A6 的前提）：

- dataset      標註資料的載入與期望軌跡推導
- normalization/comparison   標註 vs 抽取的比對規則（移植自 TS，行為必須相同）
- metrics      11 項既有指標（移植自 TS）
- trajectory   4 項 agent 專屬指標（新增）
- analysis     統計層：Wilson 信賴區間、McNemar 檢定、樣本量檢定力
- runner       對真實 agent 跑整份 golden set
"""
