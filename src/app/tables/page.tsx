import { db } from "@/db";
import { restaurantTables } from "@/db/schema";
import { asc, sql } from "drizzle-orm";
import { ensureSeeded } from "@/db/seed";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/perms";
import { redirect } from "next/navigation";
import { TablesClient, type TableCard } from "./tables-client";

export const dynamic = "force-dynamic";

type OccRow = {
  id: number; order_no: string; table_id: number | null; type: string;
  total_cents: number; created_at: string; items: number;
};

export default async function TablesPage() {
  await ensureSeeded();
  const session = await getSession();
  if (!session || !can(session.role, "tables")) redirect("/");

  const tables = await db.select().from(restaurantTables).orderBy(asc(restaurantTables.id));
  const open = await db.execute(sql`
    select o.id, o.order_no, o.table_id, o.type, o.total_cents, o.created_at,
           count(oi.id)::int as items
    from orders o
    left join order_items oi on oi.order_id = o.id and oi.status != 'voided'
    where o.status = 'open'
    group by o.id order by o.created_at
  `).then((r) => r.rows as OccRow[]);

  const cards: TableCard[] = tables.map((t) => {
    const occ = open.find((o) => o.table_id === t.id);
    return {
      id: t.id, name: t.name, seats: t.seats, x: t.x, y: t.y, w: t.w, h: t.h, shape: t.shape,
      order: occ ? {
        id: occ.id, orderNo: occ.order_no, totalCents: occ.total_cents,
        openedAt: occ.created_at, items: occ.items,
      } : null,
    };
  });

  const offFloor = open.filter((o) => o.table_id == null).map((o) => ({
    id: o.id, orderNo: o.order_no, type: o.type, totalCents: o.total_cents, createdAt: o.created_at,
  }));

  return <TablesClient cards={cards} offFloor={offFloor} />;
}
