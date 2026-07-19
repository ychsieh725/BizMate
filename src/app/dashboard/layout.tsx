import { LayoutGrid, FileText, Tag, Settings, LogOut } from "lucide-react";
import { requireMerchant } from "@/lib/auth/requireMerchant.ts";
import { merchantsRepository } from "@/domains/merchant/repositories/merchantsRepository.ts";
import { logoutAction } from "./actions.ts";
import { PAGE_ROUTES } from "@/shared/constants/routes.ts";
import { RailNavLink } from "./RailNavLink.tsx";

const NAV_ITEMS = [
  { href: PAGE_ROUTES.dashboard, label: "總覽", icon: LayoutGrid, testId: "dashboard-nav-overview" },
  { href: PAGE_ROUTES.dashboardQuotes, label: "報價", icon: FileText, testId: "dashboard-nav-quotes" },
  { href: PAGE_ROUTES.dashboardServices, label: "服務", icon: Tag, testId: "dashboard-nav-services" },
  { href: PAGE_ROUTES.dashboardSettings, label: "設定", icon: Settings, testId: "dashboard-nav-settings" },
] as const;

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = await requireMerchant();

  if (!auth.ok) {
    return (
      <div className="flex min-h-screen flex-1 flex-col items-center justify-center gap-4 bg-surface-subtle p-8">
        <p className="text-danger">
          {auth.status === 401 ? "請先登入" : "查無商家資料，請先完成 onboarding"}
        </p>
      </div>
    );
  }

  const merchant = await merchantsRepository.findById(auth.merchantId);
  const initial = merchant?.display_name?.charAt(0) ?? "商";

  return (
    <div className="flex min-h-screen flex-1 gap-4 bg-surface-subtle p-4">
      <nav
        aria-label="後台導覽"
        className="sticky top-4 flex h-[calc(100vh-2rem)] w-24 flex-none flex-col items-center gap-2 self-start rounded-2xl border border-surface-line bg-surface py-4 shadow-card"
      >
        <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-ink font-mono text-sm font-medium text-surface">
          BM
        </div>

        {NAV_ITEMS.map((item) => (
          <RailNavLink
            key={item.href}
            href={item.href}
            label={item.label}
            testId={item.testId}
          >
            <item.icon className="h-[22.5px] w-[22.5px]" strokeWidth={1.6} />
          </RailNavLink>
        ))}

        <div className="flex-1" />

        <form action={logoutAction}>
          <button
            type="submit"
            aria-label="登出"
            className="flex h-9 w-9 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-surface-subtle hover:text-ink focus:outline-none focus:ring-2 focus:ring-accent-soft"
          >
            <LogOut className="h-[15px] w-[15px]" strokeWidth={1.6} />
          </button>
        </form>

        <div
          className="mt-1 flex h-9 w-9 items-center justify-center rounded-full bg-accent text-xs font-bold text-white"
          title={merchant?.display_name ?? undefined}
        >
          {initial}
        </div>
      </nav>

      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
