import { db } from "@/db";
import { sql } from "drizzle-orm";
import { ensureSeeded } from "@/db/seed";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/perms";
import { redirect } from "next/navigation";
import { ReportsClient } from "./reports-client";
import { computeMenuCosts, type FoodCostRow } from "@/lib/foodcost";

export const dynamic = "force-dynamic";

export type Summary = {
  orders: number; revenue: number; tax: number; tips: number; discounts: number; cogs: number;
};
export type DayRow = { day: string; revenue: number; orders: number };
export type MixRow = { method?: string; type?: string; total: number; count: number };
export type ItemRow = { name: string; qty: number; revenue: number };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  await ensureSeeded();
  const session = await getSession();
  if (!session || !can(session.role, "reports")) redirect("/");
  const { range } = await searchParams;
  const days = [7, 14, 30].includes(Number(range)) ? Number(range) : 14;

  const [summary] = await db.execute(sql`
    select count(*)::int as orders, coalesce(sum(total_cents),0)::int as revenue,
           coalesce(sum(tax_cents),0)::int as tax, coalesce(sum(tip_cents),0)::int as tips,
           coalesce(sum(discount_cents),0)::int as discounts, coalesce(sum(cogs_cents),0)::int as cogs
    from orders where status = 'completed' and closed_at >= now() - make_interval(days => ${days})
  `).then((r) => r.rows as unknown as Summary[]);

  const series = await db.execute(sql`
    select to_char(date_trunc('day', closed_at), 'Dy DD') as day,
           sum(total_cents)::int as revenue, count(*)::int as orders
    from orders where status = 'completed' and closed_at >= now() - make_interval(days => ${days})
    group by 1, date_trunc('day', closed_at) order by date_trunc('day', closed_at)
  `).then((r) => r.rows as unknown as DayRow[]);

  const payMix = await db.execute(sql`
    select p.method, sum(p.amount_cents)::int as total, count(*)::int as count
    from payments p where not p.refunded and p.created_at >= now() - make_interval(days => ${days})
    group by p.method order by total desc
  `).then((r) => r.rows as unknown as MixRow[]);

  const typeMix = await db.execute(sql`
    select type, sum(total_cents)::int as total, count(*)::int as count
    from orders where status = 'completed' and closed_at >= now() - make_interval(days => ${days})
    group by type order by total desc
  `).then((r) => r.rows as unknown as MixRow[]);

  const items = await db.execute(sql`
    select oi.name, sum(oi.qty)::int as qty, sum(oi.qty * oi.unit_price_cents)::int as revenue
    from order_items oi join orders o on o.id = oi.order_id
    where o.status = 'completed' and o.closed_at >= now() - make_interval(days => ${days})
      and oi.status != 'voided'
    group by oi.name order by revenue desc limit 10
  `).then((r) => r.rows as unknown as ItemRow[]);

  const foodCost: FoodCostRow[] = await computeMenuCosts();
  const canExport = can(session.role, "export");

  return (
    <ReportsClient
      days={days} summary={summary} series={series} payMix={payMix}
      typeMix={typeMix} items={items} foodCost={foodCost} canExport={canExport}
    />
  );
}
