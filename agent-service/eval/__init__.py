"""Trajectory Eval（A5）。

**離線執行。** 這裡的程式碼只在人手動跑 eval 時載入，服務執行期碰不到——
本套件永遠不該被 app/ 匯入。日後部署本服務時，需以 `functions.excludeFiles`
把整個 eval/ 排除於 function bundle 之外（Python 無自動 tree-shaking）。

分層與 TypeScript 端一致，讓兩個 runner 的輸出可以直接對照（A6 的前提）：

- dataset      標註資料的載入與期望軌跡推導
- normalization/comparison   標註 vs 抽取的比對規則（移植自 TS，行為必須相同）
- metrics      11 項既有指標（移植自 TS）
- trajectory   4 項 agent 專屬指標（新增）
- analysis     統計層：Wilson 信賴區間、McNemar 檢定、樣本量檢定力
- runner       對真實 agent 跑整份 golden set
"""
