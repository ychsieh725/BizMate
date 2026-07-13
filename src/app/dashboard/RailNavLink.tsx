"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function RailNavLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
        active ? "bg-ink text-surface" : "text-ink-soft hover:bg-black/5"
      }`}
    >
      {children}
    </Link>
  );
}
