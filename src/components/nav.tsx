"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Flame, LayoutDashboard, UtensilsCrossed, LayoutGrid, Receipt, Clock,
  Boxes, BarChart3, Users, FileText, LogOut,
} from "lucide-react";
import { can, ROLE_LABELS, type Perm } from "@/lib/perms";
import { logout } from "@/actions/auth";

const LINKS: { href: string; label: string; perm: Perm; Icon: typeof Flame }[] = [
  { href: "/", label: "Overview", perm: "dashboard", Icon: LayoutDashboard },
  { href: "/pos", label: "POS Terminal", perm: "pos", Icon: UtensilsCrossed },
  { href: "/tables", label: "Floor Plan", perm: "tables", Icon: LayoutGrid },
  { href: "/kitchen", label: "Kitchen Display", perm: "kitchen", Icon: Flame },
  { href: "/orders", label: "Orders", perm: "orders", Icon: Receipt },
  { href: "/shifts", label: "Shifts & Cash", perm: "shifts", Icon: Clock },
  { href: "/inventory", label: "Inventory", perm: "inventory", Icon: Boxes },
  { href: "/reports", label: "Reports", perm: "reports", Icon: BarChart3 },
  { href: "/admin/users", label: "Team & Audit", perm: "team", Icon: Users },
  { href: "/spec", label: "Blueprint", perm: "spec", Icon: FileText },
];

export function Nav({ user }: { user: { name: string; role: string } }) {
  const pathname = usePathname();
  return (
    <aside className="no-print flex w-60 shrink-0 flex-col border-r border-zinc-800 bg-zinc-925 bg-zinc-950">
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-ember-500 to-ember-700 shadow-lg shadow-ember-600/20">
          <Flame className="h-5 w-5 text-white" strokeWidth={2.2} />
        </div>
        <div>
          <div className="font-display text-base font-bold leading-tight tracking-tight">Ember &amp; Ivy</div>
          <div className="text-[11px] font-medium uppercase tracking-widest text-zinc-500">POS Platform</div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
        {LINKS.filter((l) => can(user.role, l.perm)).map(({ href, label, Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-ember-500/10 text-ember-400"
                  : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
              }`}
            >
              <Icon className="h-4 w-4" strokeWidth={2} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-zinc-800 p-4">
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-800 text-sm font-bold text-ember-400">
            {user.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{user.name}</div>
            <div className="text-xs text-zinc-500">{ROLE_LABELS[user.role] ?? user.role}</div>
          </div>
        </div>
        <form action={logout}>
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
          >
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
