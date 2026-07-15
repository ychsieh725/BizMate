"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function RailNavLink({
  href,
  label,
  testId,
  children,
}: {
  href: string;
  label: string;
  testId: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  // href 本身若還有子層（如 /dashboard/quotes 底下的 [id]），子頁面仍要讓
  // 對應的 tab 保持 active，故用 startsWith。但 /dashboard 是所有子路由的
  // 前綴，若同樣套用 startsWith 會導致「總覽」在任何 /dashboard/* 頁面都
  // 被誤判為 active——這裡只對「本身還有下一層路徑」的 href 才做前綴比對。
  const isNestedRoute = href.split("/").filter(Boolean).length > 1;
  const active = pathname === href || (isNestedRoute && pathname.startsWith(`${href}/`));

  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      data-testid={testId}
      className={`flex h-[54px] w-[54px] items-center justify-center rounded-full transition-colors ${
        active ? "bg-ink text-surface" : "text-ink-soft hover:bg-black/5"
      }`}
    >
      {children}
    </Link>
  );
}
