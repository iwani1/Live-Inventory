import { NextRequest } from "next/server";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/perms";
import { computeMenuCosts } from "@/lib/foodcost";

export const dynamic = "force-dynamic";

function csv(rows: (string | number)[][]): string {
  return rows
    .map((r) => r.map((c) => {
      const s = String(c);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(","))
    .join("\n");
}
const dollars = (c: number) => (c / 100).toFixed(2);

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !can(session.role, "export")) {
    return new Response("Forbidden", { status: 403 });
  }
  const report = req.nextUrl.searchParams.get("report") ?? "sales";
  const days = Math.min(90, Math.max(1, Number(req.nextUrl.searchParams.get("range") ?? 14)));

  let body = "";
  let filename = `${report}.csv`;

  if (report === "sales") {
    const rows = await db.execute(sql`
      select date_trunc('day', closed_at)::date as day, count(*)::int as orders,
             sum(subtotal_cents)::int as subtotal, sum(discount_cents)::int as discounts,
             sum(tax_cents)::int as tax, sum(tip_cents)::int as tips,
             sum(total_cents)::int as revenue, sum(cogs_cents)::int as cogs
      from orders where status = 'completed' and closed_at >= now() - make_interval(days => ${days})
      group by 1 order by 1
    `).then((r) => r.rows as Record<string, string | number>[]);
    body = csv([
      ["date", "orders", "gross_sales_usd", "discounts_usd", "tax_usd", "tips_usd", "revenue_usd", "cogs_usd", "gross_margin_pct"],
      ...rows.map((r) => [
        r.day, r.orders, dollars(Number(r.subtotal)), dollars(Number(r.discounts)),
        dollars(Number(r.tax)), dollars(Number(r.tips)), dollars(Number(r.revenue)),
        dollars(Number(r.cogs)),
        Number(r.revenue) > 0 ? (((Number(r.revenue) - Number(r.cogs)) / Number(r.revenue)) * 100).toFixed(1) : "0",
      ]),
    ]);
  } else if (report === "items") {
    const rows = await db.execute(sql`
      select oi.name, sum(oi.qty)::int as qty, sum(oi.qty * oi.unit_price_cents)::int as revenue
      from order_items oi join orders o on o.id = oi.order_id
      where o.status = 'completed' and o.closed_at >= now() - make_interval(days => ${days}) and oi.status != 'voided'
      group by oi.name order by revenue desc
    `).then((r) => r.rows as Record<string, string | number>[]);
    body = csv([
      ["item", "qty_sold", "revenue_usd"],
      ...rows.map((r) => [r.name, r.qty, dollars(Number(r.revenue))]),
    ]);
  } else if (report === "foodcost") {
    const costs = await computeMenuCosts();
    body = csv([
      ["menu_item", "price_usd", "recipe_cost_usd", "food_cost_pct", "margin_usd"],
      ...costs.map((c) => [
        c.name, dollars(c.priceCents), dollars(c.recipeCostCents),
        (c.foodCostPct * 100).toFixed(1), dollars(c.marginCents),
      ]),
    ]);
  } else if (report === "inventory") {
    const rows = await db.execute(sql`
      select i.name, i.unit, i.stock_qty::float as stock, i.reorder_level::float as reorder,
             i.avg_cost_cents::float as cost, s.name as supplier
      from ingredients i left join suppliers s on s.id = i.supplier_id where i.active order by i.name
    `).then((r) => r.rows as Record<string, string | number>[]);
    body = csv([
      ["ingredient", "unit", "on_hand", "reorder_level", "avg_cost_cents", "stock_value_usd", "supplier"],
      ...rows.map((r) => [
        r.name, r.unit, r.stock, r.reorder, r.cost,
        ((Number(r.stock) * Number(r.cost)) / 100).toFixed(2), r.supplier ?? "",
      ]),
    ]);
  } else {
    return new Response("Unknown report", { status: 400 });
  }

  filename = `ember-${report}-${days}d.csv`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
