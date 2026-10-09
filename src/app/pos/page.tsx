import { db } from "@/db";
import {
  categories, menuItems, modifierGroups, modifierOptions, itemModifierGroups,
  restaurantTables, orders, orderItems, payments, settings,
} from "@/db/schema";
import { eq, asc, and, ne } from "drizzle-orm";
import { ensureSeeded } from "@/db/seed";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/perms";
import { redirect } from "next/navigation";
import { PosClient, type PosMenuItem, type PosOrder } from "./pos-client";

export const dynamic = "force-dynamic";

export default async function PosPage({ searchParams }: { searchParams: Promise<{ order?: string; table?: string }> }) {
  await ensureSeeded();
  const session = await getSession();
  if (!session || !can(session.role, "pos")) redirect("/");
  const { order: orderParam, table: tableParam } = await searchParams;

  const cats = await db.select().from(categories).orderBy(asc(categories.sort));
  const items = await db.select().from(menuItems).where(eq(menuItems.active, true));
  const imgs = await db.select().from(itemModifierGroups);
  const groups = await db.select().from(modifierGroups);
  const options = await db.select().from(modifierOptions);
  const tables = await db.select().from(restaurantTables).orderBy(asc(restaurantTables.id));

  const openOrders = await db
    .select({ id: orders.id, tableId: orders.tableId, orderNo: orders.orderNo })
    .from(orders)
    .where(eq(orders.status, "open"));

  const menu: PosMenuItem[] = items.map((i) => ({
    id: i.id, name: i.name, priceCents: i.priceCents, categoryId: i.categoryId,
    color: i.color, isCombo: i.isCombo,
    groups: imgs
      .filter((g) => g.itemId === i.id)
      .map((g) => {
        const grp = groups.find((x) => x.id === g.groupId)!;
        return {
          id: grp.id, name: grp.name, required: grp.required, min: grp.min, max: grp.max,
          options: options
            .filter((o) => o.groupId === grp.id)
            .map((o) => ({ id: o.id, name: o.name, priceDeltaCents: o.priceDeltaCents })),
        };
      }),
  }));

  let currentOrder: PosOrder | null = null;
  if (orderParam) {
    const oid = Number(orderParam);
    const [ord] = await db.select().from(orders).where(eq(orders.id, oid));
    if (ord && ord.status === "open") {
      const lines = await db.select().from(orderItems)
        .where(and(eq(orderItems.orderId, oid), ne(orderItems.status, "voided")))
        .orderBy(asc(orderItems.id));
      const pays = await db.select().from(payments)
        .where(and(eq(payments.orderId, oid), eq(payments.refunded, false)));
      currentOrder = {
        id: ord.id, orderNo: ord.orderNo, type: ord.type, tableId: ord.tableId,
        customerName: ord.customerName, customerPhone: ord.customerPhone,
        deliveryAddress: ord.deliveryAddress, notes: ord.notes,
        subtotalCents: ord.subtotalCents, discountCents: ord.discountCents,
        taxCents: ord.taxCents, tipCents: ord.tipCents, totalCents: ord.totalCents,
        discountLabel: ord.discountLabel,
        lines: lines.map((l) => ({
          id: l.id, name: l.name, qty: l.qty, seat: l.seat, unitPriceCents: l.unitPriceCents,
          modifiers: l.modifiers, status: l.status, notes: l.notes,
        })),
        paidCents: pays.reduce((s, p) => s + p.amountCents, 0),
      };
    }
  }

  const [taxRow] = await db.select().from(settings).where(eq(settings.key, "tax_rate_bps"));

  return (
    <PosClient
      categories={cats.map((c) => ({ id: c.id, name: c.name }))}
      menu={menu}
      tables={tables.map((t) => ({ id: t.id, name: t.name, seats: t.seats }))}
      busyTableIds={openOrders.filter((o) => o.tableId != null).map((o) => o.tableId as number)}
      openOrders={openOrders}
      initialOrder={currentOrder}
      initialTableId={tableParam ? Number(tableParam) : null}
      taxRateBps={Number(taxRow?.value ?? 850)}
      canVoid={can(session.role, "void")}
    />
  );
}
