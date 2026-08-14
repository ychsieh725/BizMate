import { SiteHeader } from "./_landing/SiteHeader";
import { Hero } from "./_landing/Hero";
import { HowItWorks } from "./_landing/HowItWorks";
import { TechHighlights } from "./_landing/TechHighlights";
import { ClosingCta } from "./_landing/ClosingCta";
import { SiteFooter } from "./_landing/SiteFooter";

/**
 * BizMate 行銷首頁（根目錄）。
 * 多租戶重構後報價入口是各商家的專屬連結 /q/{slug}，首頁不再直連 wizard，
 * 改導流註冊/登入；客戶若已有商家連結，頁尾另有說明。
 *
 * 版面組成拆在 _landing/（底線前綴＝Next.js 私有資料夾，不會產生路由）。
 */
export default function Home() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1 bg-white">
        <Hero />
        <HowItWorks />
        <TechHighlights />
        <ClosingCta />
      </main>
      <SiteFooter />
    </>
  );
}
