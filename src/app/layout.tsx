import type { Metadata } from "next";
import { Geist, Geist_Mono, Noto_Sans_TC } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * 中文字型。先前未指定任何中文字型，中文一律 fallback 到各作業系統的預設
 * （macOS 蘋方 / Windows 微軟正黑），字重與字面大小在平台間不一致——這是
 * 介面質感最明顯的落差來源。Noto Sans TC 與 Geist 的幾何感相容，
 * 由 next/font 自動 subset 與 self-host，不額外增加第三方請求。
 */
const notoSansTC = Noto_Sans_TC({
  variable: "--font-noto-sans-tc",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

/**
 * metadataBase 供 Next 把 opengraph-image 展開成絕對網址（社群平台只吃絕對 URL）。
 * 刻意不進 env.ts 的 zod 必填清單——這是建置期的可選常數，缺了只影響分享預覽，
 * 不該讓應用啟動失敗。Vercel 會自動注入 VERCEL_URL。
 */
const siteUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

const SITE_DESCRIPTION =
  "客戶用口語描述需求 → AI 解析成結構化欄位 → 確定性計價 → 商家後台審核 → Email 寄出正式報價單。";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "BizMate — 自動化報價系統",
  description: SITE_DESCRIPTION,
  openGraph: {
    title: "BizMate — 自動化報價系統",
    description: SITE_DESCRIPTION,
    type: "website",
    locale: "zh_TW",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-Hant"
      className={`${geistSans.variable} ${geistMono.variable} ${notoSansTC.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
