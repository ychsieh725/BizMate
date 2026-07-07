import { notFound } from "next/navigation";
import { merchantsRepository } from "@/domains/merchant/repositories/merchantsRepository.ts";
import { WizardPage } from "./WizardPage.tsx";

/**
 * 商家專屬報價入口 /q/{slug}（server component）。
 * 在伺服器端解析 slug → 商家：查無直接 404，合法才渲染 wizard，
 * 並把商家名帶進頁首，讓客戶知道是在對誰報價。
 */
export default async function QuoteEntryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const merchant = await merchantsRepository.findBySlug(slug);
  if (merchant == null) {
    notFound();
  }

  return <WizardPage slug={slug} merchantName={merchant.display_name} />;
}
