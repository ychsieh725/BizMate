import { ImageResponse } from "next/og";

/**
 * 社群分享預覽圖（1200×630），由 next/og 於建置時產生 PNG。
 *
 * 刻意全英文：ImageResponse 底層的 satori 只內建拉丁字型，未嵌入中文字型時
 * 中文字會渲染成空白方塊。嵌入思源黑體等中文字型需拉進數 MB 字型檔，
 * 對一張分享圖不划算——改用「英文 + 數字」呈現，數字本身就是最強的訊息。
 */
export const alt = "BizMate — Eval-Driven AI Quoting SaaS";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const METRICS = [
  { value: "97.1%", label: "FIELD ACCURACY" },
  { value: "0%", label: "HALLUCINATION" },
  { value: "503", label: "TESTS PASSING" },
] as const;

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#1b1a20",
          padding: "72px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              fontSize: 30,
              letterSpacing: 8,
              color: "#7f97e0",
            }}
          >
            BIZMATE
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 78,
              fontWeight: 700,
              color: "#ffffff",
              lineHeight: 1.15,
              marginTop: 28,
            }}
          >
            Eval-Driven AI Quoting SaaS
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 32,
              color: "#a8a6b3",
              marginTop: 24,
            }}
          >
            LLM output quality as a measurable, regression-tested asset
          </div>
        </div>

        <div style={{ display: "flex", gap: "56px" }}>
          {METRICS.map((metric) => (
            <div
              key={metric.label}
              style={{ display: "flex", flexDirection: "column" }}
            >
              {/* 品牌藍 #2451c4 在深底上僅約 3:1 對比，數字是主角須更亮 */}
              <div style={{ display: "flex", fontSize: 62, fontWeight: 700, color: "#9db4f5" }}>
                {metric.value}
              </div>
              <div
                style={{
                  display: "flex",
                  fontSize: 22,
                  letterSpacing: 3,
                  color: "#8a8794",
                  marginTop: 8,
                }}
              >
                {metric.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
