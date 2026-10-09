import { db } from "@/db";
import { sql } from "drizzle-orm";
import { ensureSeeded } from "@/db/seed";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/perms";
import { redirect } from "next/navigation";
import { InventoryClient, type InvIngredient, type InvMovement, type InvPO, type InvSupplier } from "./inventory-client";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  await ensureSeeded();
  const session = await getSession();
  if (!session || !can(session.role, "inventory")) redirect("/");

  const ingredients = await db.execute(sql`
    select i.id, i.name, i.unit, i.stock_qty::float as stock, i.reorder_level::float as reorder,
           i.avg_cost_cents::float as cost, s.name as supplier_name
    from ingredients i left join suppliers s on s.id = i.supplier_id
    where i.active order by i.name
  `).then((r) => r.rows as { id: number; name: string; unit: string; stock: number; reorder: number; cost: number; supplier_name: string | null }[]);

  const movements = await db.execute(sql`
    select m.id, i.name as ingredient, m.type, m.qty_delta::float as qty, m.unit_cost_cents::float as cost,
           m.note, m.ref_type, m.created_at, u.name as user_name
    from stock_movements m
    join ingredients i on i.id = m.ingredient_id
    left join users u on u.id = m.user_id
    order by m.created_at desc limit 60
  `).then((r) => r.rows as { id: number; ingredient: string; type: string; qty: number; cost: number; note: string | null; ref_type: string | null; created_at: string; user_name: string | null }[]);

  const suppliers = await db.execute(sql`select * from suppliers order by name`)
    .then((r) => r.rows as unknown as { id: number; name: string; contact: string | null; email: string | null; phone: string | null; lead_time_days: number; notes: string | null }[]);

  const pos = await db.execute(sql`
    select p.id, p.status, p.total_cents, p.notes, p.created_at, p.received_at, s.name as supplier_name
    from purchase_orders p join suppliers s on s.id = p.supplier_id
    order by p.created_at desc limit 30
  `).then((r) => r.rows as { id: number; status: string; total_cents: number; notes: string | null; created_at: string; received_at: string | null; supplier_name: string }[]);

  const poItems = await db.execute(sql`
    select pi.po_id, pi.ingredient_id, i.name, pi.qty::float as qty, pi.unit_cost_cents::float as cost
    from purchase_order_items pi join ingredients i on i.id = pi.ingredient_id
    where pi.po_id in (select id from purchase_orders order by created_at desc limit 30)
    order by pi.id
  `).then((r) => r.rows as { po_id: number; ingredient_id: number; name: string; qty: number; cost: number }[]);

  const invIngredients: InvIngredient[] = ingredients.map((i) => ({
    id: i.id, name: i.name, unit: i.unit, stockQty: i.stock, reorderLevel: i.reorder,
    avgCostCents: i.cost, supplierName: i.supplier_name,
    low: i.stock <= i.reorder, valueCents: i.stock * i.cost,
  }));
  const invMovements: InvMovement[] = movements.map((m) => ({
    id: m.id, ingredientName: m.ingredient, type: m.type, qtyDelta: m.qty,
    unitCostCents: m.cost, note: m.note, refType: m.ref_type, createdAt: m.created_at, userName: m.user_name,
  }));
  const invSuppliers: InvSupplier[] = suppliers.map((s) => ({
    id: s.id, name: s.name, contact: s.contact, email: s.email, phone: s.phone,
    leadTimeDays: s.lead_time_days, notes: s.notes,
  }));
  const invPOs: InvPO[] = pos.map((p) => ({
    id: p.id, status: p.status, totalCents: p.total_cents, notes: p.notes,
    createdAt: p.created_at, receivedAt: p.received_at, supplierName: p.supplier_name,
    items: poItems.filter((i) => i.po_id === p.id).map((i) => ({
      ingredientId: i.ingredient_id, name: i.name, qty: i.qty, unitCostCents: i.cost,
    })),
  }));

  return (
    <InventoryClient
      ingredients={invIngredients}
      movements={invMovements}
      suppliers={invSuppliers}
      purchaseOrders={invPOs}
    />
  );
}
