import { db } from "@/db";
import { sql } from "drizzle-orm";
import { ensureSeeded } from "@/db/seed";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/perms";
import { redirect } from "next/navigation";
import { KitchenClient, type Ticket } from "./kitchen-client";

export const dynamic = "force-dynamic";

type Row = {
  line_id: number; name: string; qty: number; seat: number; status: string; notes: string | null;
  modifiers: { name: string; priceCents: number }[];
  order_id: number; order_no: string; type: string; order_created: string; table_name: string | null;
};

export default async function KitchenPage() {
  await ensureSeeded();
  const session = await getSession();
  if (!session || !can(session.role, "kitchen")) {
    if (session && can(session.role, "pos")) redirect("/pos");
    redirect("/login");
  }

  const rows = await db.execute(sql`
    select oi.id as line_id, oi.name, oi.qty, oi.seat, oi.status, oi.notes, oi.modifiers,
           o.id as order_id, o.order_no, o.type, o.created_at as order_created,
           rt.name as table_name
    from order_items oi
    join orders o on o.id = oi.order_id
    left join restaurant_tables rt on rt.id = o.table_id
    where o.status = 'open' and oi.status in ('fired','preparing','ready')
    order by o.created_at asc, oi.id asc
  `).then((r) => r.rows as Row[]);

  const tickets = new Map<number, Ticket>();
  for (const r of rows) {
    if (!tickets.has(r.order_id)) {
      tickets.set(r.order_id, {
        orderId: r.order_id, orderNo: r.order_no, type: r.type,
        tableName: r.table_name, createdAt: r.order_created, lines: [],
      });
    }
    tickets.get(r.order_id)!.lines.push({
      id: r.line_id, name: r.name, qty: r.qty, seat: r.seat,
      status: r.status, notes: r.notes, modifiers: r.modifiers ?? [],
    });
  }

  return <KitchenClient tickets={[...tickets.values()]} />;
}
