import { db } from "@/db";
import { sql } from "drizzle-orm";
import { ensureSeeded } from "@/db/seed";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/perms";
import { redirect } from "next/navigation";
import { OrdersClient, type OrderRow } from "./orders-client";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  await ensureSeeded();
  const session = await getSession();
  if (!session || !can(session.role, "orders")) redirect("/");

  const orders = await db.execute(sql`
    select o.id, o.order_no, o.type, o.status, o.subtotal_cents, o.discount_cents,
           o.tax_cents, o.tip_cents, o.total_cents, o.cogs_cents, o.refund_reason,
           o.created_at, rt.name as table_name, u.name as opened_by
    from orders o
    left join restaurant_tables rt on rt.id = o.table_id
    left join users u on u.id = o.opened_by
    order by o.created_at desc limit 120
  `).then((r) => r.rows as Omit<OrderRow, "lines" | "payments">[]);

  const lines = await db.execute(sql`
    select oi.order_id, oi.id, oi.name, oi.qty, oi.unit_price_cents, oi.modifiers, oi.status, oi.seat
    from order_items oi join orders o on o.id = oi.order_id
    where o.id in (select id from orders order by created_at desc limit 120)
      and oi.status != 'voided'
    order by oi.id
  `).then((r) => r.rows as { order_id: number; id: number; name: string; qty: number; unit_price_cents: number; modifiers: { name: string; priceCents: number }[]; status: string; seat: number }[]);

  const pays = await db.execute(sql`
    select p.order_id, p.method, p.amount_cents, p.refunded
    from payments p join orders o on o.id = p.order_id
    where o.id in (select id from orders order by created_at desc limit 120)
    order by p.id
  `).then((r) => r.rows as { order_id: number; method: string; amount_cents: number; refunded: boolean }[]);

  const rows: OrderRow[] = orders.map((o) => ({
    ...o,
    lines: lines.filter((l) => l.order_id === o.id).map((l) => ({
      id: l.id, name: l.name, qty: l.qty, unitPriceCents: l.unit_price_cents,
      modifiers: l.modifiers ?? [], status: l.status, seat: l.seat,
    })),
    payments: pays.filter((p) => p.order_id === o.id).map((p) => ({
      method: p.method, amountCents: p.amount_cents, refunded: p.refunded,
    })),
  }));

  return (
    <OrdersClient
      rows={rows}
      canRefund={can(session.role, "refund")}
      canVoid={can(session.role, "void")}
    />
  );
}
