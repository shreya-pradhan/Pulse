"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/pages", label: "Tracked pages" },
];

export default function DashboardNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-6 border-b border-zinc-200 bg-white px-6">
      <div className="mx-auto flex w-full max-w-4xl gap-6">
        {LINKS.map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`-mb-px border-b-2 px-1 py-3 text-sm transition-colors ${
                active
                  ? "border-indigo-600 font-medium text-zinc-900"
                  : "border-transparent text-zinc-500 hover:text-zinc-800"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
