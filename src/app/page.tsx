import { db } from "@/db";
import { orders, ingredients, orderItems } from "@/db/schema";
import { sql } from "drizzle-orm";
import { money, qty, unitCost } from "@/lib/format";
import { RevenueChart } from "@/components/revenue-chart";
import Link from "next/link";
import {
  DollarSign, Receipt, TrendingUp, AlertTriangle, Flame, ArrowRight,
  UtensilsCrossed, Boxes, LayoutGrid, FileText,
} from "lucide-react";

export const dynamic = "force-dynamic";

type DayRow = { day: string; revenue: number; orders: number };
type TopRow = { name: string; qty: number; revenue: number };

export default async function Dashboard() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [today] = await db.execute(sql`
    select count(*)::int as orders, coalesce(sum(total_cents),0)::int as revenue,
           coalesce(sum(cogs_cents),0)::int as cogs
    from orders where status = 'completed' and closed_at >= ${todayStart}
  `).then((r) => r.rows as { orders: number; revenue: number; cogs: number }[]);

  const [open] = await db.execute(sql`
    select count(*)::int as open_orders from orders where status = 'open'
  `).then((r) => r.rows as { open_orders: number }[]);

  const [kdsActive] = await db.execute(sql`
    select count(*)::int as tickets from (
      select distinct oi.order_id from order_items oi
      join orders o on o.id = oi.order_id
      where o.status = 'open' and oi.status in ('fired','preparing')
    ) t
  `).then((r) => r.rows as { tickets: number }[]);

  const lowStock = await db.execute(sql`
    select id, name, unit, stock_qty::float as stock, reorder_level::float as reorder, avg_cost_cents::float as cost
    from ingredients where active and stock_qty::numeric <= reorder_level::numeric order by name
  `).then((r) => r.rows as { id: number; name: string; unit: string; stock: number; reorder: number; cost: number }[]);

  const series = await db.execute(sql`
    select to_char(date_trunc('day', closed_at), 'Dy DD') as day,
           sum(total_cents)::int as revenue, count(*)::int as orders
    from orders where status = 'completed' and closed_at >= now() - interval '13 days'
    group by 1, date_trunc('day', closed_at) order by date_trunc('day', closed_at)
  `).then((r) => r.rows as DayRow[]);

  const topItems = await db.execute(sql`
    select oi.name, sum(oi.qty)::int as qty, sum(oi.qty * oi.unit_price_cents)::int as revenue
    from order_items oi join orders o on o.id = oi.order_id
    where o.status = 'completed' and o.closed_at >= now() - interval '7 days'
    group by oi.name order by qty desc limit 5
  `).then((r) => r.rows as TopRow[]);

  const recent = await db.execute(sql`
    select o.id, o.order_no, o.type, o.total_cents, o.status, o.created_at
    from orders o order by o.created_at desc limit 7
  `).then((r) => r.rows as { id: number; order_no: string; type: string; total_cents: number; status: string; created_at: string }[]);

  const avgTicket = today.orders > 0 ? Math.round(today.revenue / today.orders) : 0;
  const margin = today.revenue > 0 ? Math.round(((today.revenue - today.cogs) / today.revenue) * 100) : 0;

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Overview</h1>
          <p className="mt-1 text-sm text-zinc-500">Today at Ember &amp; Ivy — live service snapshot</p>
        </div>
        <Link href="/spec" className="flex items-center gap-2 rounded-xl border border-ember-500/40 bg-ember-500/10 px-4 py-2.5 text-sm font-semibold text-ember-300 transition-colors hover:bg-ember-500/20">
          <FileText className="h-4 w-4" /> Technical blueprint &amp; GreenGeeks plan <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: "Today's revenue", value: money(today.revenue), sub: `${today.orders} orders`, Icon: DollarSign },
          { label: "Average ticket", value: money(avgTicket), sub: `${margin}% gross margin today`, Icon: TrendingUp },
          { label: "Open orders", value: String(open.open_orders), sub: `${kdsActive.tickets} active kitchen tickets`, Icon: Receipt },
          { label: "Low stock alerts", value: String(lowStock.length), sub: lowStock.length ? "Action needed" : "All stocked", Icon: AlertTriangle, warn: lowStock.length > 0 },
        ].map(({ label, value, sub, Icon, warn }) => (
          <div key={label} className="rise-in rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{label}</span>
              <Icon className={`h-4 w-4 ${warn ? "text-amber-400" : "text-ember-500"}`} />
            </div>
            <div className="font-display text-3xl font-bold tracking-tight">{value}</div>
            <div className={`mt-1 text-xs ${warn ? "font-semibold text-amber-400" : "text-zinc-500"}`}>{sub}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        {/* revenue chart */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 xl:col-span-2">
          <h2 className="mb-4 text-sm font-semibold text-zinc-300">Revenue — last 14 days</h2>
          <RevenueChart data={series.map((d) => ({ day: d.day, revenue: d.revenue / 100 }))} />
        </div>

        {/* top items */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
          <h2 className="mb-4 text-sm font-semibold text-zinc-300">Top sellers — 7 days</h2>
          <div className="space-y-3">
            {topItems.map((t, i) => (
              <div key={t.name} className="flex items-center gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-xs font-bold text-ember-400">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{t.name}</div>
                  <div className="text-xs text-zinc-500">{t.qty} sold</div>
                </div>
                <div className="text-sm font-semibold">{money(t.revenue)}</div>
              </div>
            ))}
            {!topItems.length && <p className="text-sm text-zinc-500">No sales yet this week.</p>}
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        {/* low stock */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-300">Low stock</h2>
            <Link href="/inventory" className="flex items-center gap-1 text-xs font-semibold text-ember-400 hover:text-ember-300">
              <Boxes className="h-3.5 w-3.5" /> Inventory
            </Link>
          </div>
          <div className="space-y-2">
            {lowStock.slice(0, 6).map((l) => (
              <div key={l.id} className="flex items-center justify-between rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                <span className="text-sm font-medium">{l.name}</span>
                <span className="text-xs font-semibold text-amber-400">{qty(l.stock)} {l.unit} <span className="text-zinc-500">/ min {qty(l.reorder)}</span></span>
              </div>
            ))}
            {!lowStock.length && <p className="text-sm text-zinc-500">Everything is above reorder levels.</p>}
          </div>
        </div>

        {/* recent orders */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-300">Recent orders</h2>
            <Link href="/orders" className="flex items-center gap-1 text-xs font-semibold text-ember-400 hover:text-ember-300">
              <Receipt className="h-3.5 w-3.5" /> All orders
            </Link>
          </div>
          <div className="space-y-2">
            {recent.map((o) => (
              <div key={o.id} className="flex items-center justify-between rounded-lg bg-zinc-900 px-3 py-2">
                <div>
                  <span className="text-sm font-semibold">{o.order_no}</span>
                  <span className="ml-2 text-xs capitalize text-zinc-500">{o.type.replace("_", "-")}</span>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold">{money(o.total_cents)}</div>
                  <div className={`text-[11px] font-medium capitalize ${o.status === "completed" ? "text-emerald-400" : o.status === "open" ? "text-amber-400" : "text-zinc-500"}`}>{o.status}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* quick actions */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
          <h2 className="mb-4 text-sm font-semibold text-zinc-300">Quick actions</h2>
          <div className="grid grid-cols-1 gap-2">
            {[
              { href: "/pos", label: "New order", desc: "Open the POS terminal", Icon: UtensilsCrossed },
              { href: "/tables", label: "Seat guests", desc: "Floor plan & table status", Icon: LayoutGrid },
              { href: "/kitchen", label: "Kitchen display", desc: `${kdsActive.tickets} tickets in queue`, Icon: Flame },
              { href: "/inventory", label: "Stock control", desc: `${lowStock.length} ingredients below par`, Icon: Boxes },
            ].map(({ href, label, desc, Icon }) => (
              <Link key={href} href={href} className="group flex items-center gap-3 rounded-xl border border-zinc-800 p-3 transition-colors hover:border-ember-500/40 hover:bg-ember-500/5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-800 text-ember-400">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-semibold">{label}</div>
                  <div className="text-xs text-zinc-500">{desc}</div>
                </div>
                <ArrowRight className="h-4 w-4 text-zinc-600 transition-transform group-hover:translate-x-1 group-hover:text-ember-400" />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
