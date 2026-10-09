"use server";

import { db } from "@/db";
import {
  orders, orderItems, payments, menuItems, modifierOptions, comboItems, recipes, settings, shifts, ingredients,
} from "@/db/schema";
import { and, eq, ne, desc, inArray, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/perms";
import { computeTotals } from "@/lib/checkout";
import { consumeFifo, addLayer } from "@/lib/stock";
import { audit } from "@/lib/audit";
import { ensureSeeded } from "@/db/seed";
import { num } from "@/lib/format";

export type CartLineInput = {
  itemId: number;
  qty: number;
  seat: number;
  modifierOptionIds: number[];
  notes?: string;
};

async function requirePerm(perm: "pos" | "refund" | "void") {
  await ensureSeeded();
  const session = await getSession();
  if (!session) return { error: "Not signed in" as const };
  if (!can(session.role, perm)) return { error: "You don't have permission for this action." as const };
  return { session };
}

async function taxRateBps(): Promise<number> {
  const [row] = await db.select().from(settings).where(eq(settings.key, "tax_rate_bps"));
  return Number(row?.value ?? 850);
}

async function activeShiftId(userId: number): Promise<number | null> {
  const [mine] = await db.select().from(shifts)
    .where(and(eq(shifts.userId, userId), eq(shifts.status, "open"))).limit(1);
  if (mine) return mine.id;
  const [any] = await db.select().from(shifts).where(eq(shifts.status, "open")).limit(1);
  return any?.id ?? null;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Expand an order line into the items that actually carry recipes.
 * A combo has no recipe rows of its own — it must be resolved through
 * combo_items, otherwise its ingredients are never deducted on payment and
 * never restocked on refund (stock silently drifts on every combo refund).
 */
async function lineSources(
  tx: Tx, itemId: number, qty: number, depth = 0,
): Promise<{ itemId: number; mult: number }[]> {
  const [item] = await tx.select().from(menuItems).where(eq(menuItems.id, itemId));
  if (!item?.isCombo || depth > 2) return [{ itemId, mult: qty }];
  const children = await tx.select().from(comboItems).where(eq(comboItems.comboId, item.id));
  if (!children.length) return [{ itemId, mult: qty }];
  const out: { itemId: number; mult: number }[] = [];
  for (const c of children) out.push(...(await lineSources(tx, c.itemId, c.qty * qty, depth + 1)));
  return out;
}

async function recalcOrder(orderId: number): Promise<void> {
  const lines = await db
    .select({
      priceCents: orderItems.unitPriceCents, qty: orderItems.qty, taxExempt: menuItems.taxExempt,
    })
    .from(orderItems)
    .leftJoin(menuItems, eq(orderItems.itemId, menuItems.id))
    .where(and(eq(orderItems.orderId, orderId), ne(orderItems.status, "voided")));
  const [ord] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!ord) return;
  const discount =
    ord.discountCents > 0 && ord.discountLabel?.startsWith("pct:")
      ? { kind: "percent" as const, bps: Number(ord.discountLabel.slice(4)), label: ord.discountLabel }
      : ord.discountCents > 0
        ? { kind: "fixed" as const, cents: ord.discountCents, label: ord.discountLabel ?? "Discount" }
        : null;
  const totals = computeTotals(
    lines.map((l) => ({ priceCents: l.priceCents, qty: l.qty, taxExempt: !!l.taxExempt })),
    discount, ord.tipCents, await taxRateBps(),
  );
  await db.update(orders).set({
    subtotalCents: totals.subtotal, taxCents: totals.tax,
    totalCents: totals.total, updatedAt: new Date(),
  }).where(eq(orders.id, orderId));
}

// ---------------------------------------------------------------------------
// Create / append order and fire items to the kitchen
// ---------------------------------------------------------------------------
export async function sendToKitchen(input: {
  orderId?: number | null;
  type: "dine_in" | "takeaway" | "delivery";
  tableId?: number | null;
  customerName?: string;
  customerPhone?: string;
  deliveryAddress?: string;
  notes?: string;
  lines: CartLineInput[];
}): Promise<{ orderId?: number; orderNo?: string; error?: string }> {
  const guard = await requirePerm("pos");
  if ("error" in guard) return { error: guard.error };
  const { session } = guard;
  if (!input.lines.length && !input.orderId) return { error: "Add at least one item." };

  // resolve prices server-side (never trust the client)
  // NOTE: interpolate id lists with inArray(). Drizzle expands a raw JS array
  // inside a sql`` template into a comma-separated parameter list, which turns
  // `= any(($1,$2))` into a Postgres type error ("malformed array literal" /
  // "op ANY/ALL (array) requires array on right side") and broke order entry.
  const itemIds = [...new Set(input.lines.map((l) => l.itemId))];
  const items = itemIds.length
    ? await db.select().from(menuItems).where(inArray(menuItems.id, itemIds))
    : [];
  const optIds = [...new Set(input.lines.flatMap((l) => l.modifierOptionIds))];
  const opts = optIds.length
    ? await db.select().from(modifierOptions).where(inArray(modifierOptions.id, optIds))
    : [];

  const orderId = await db.transaction(async (tx) => {
    let oid = input.orderId ?? null;
    if (!oid) {
      const shiftId = await activeShiftId(session.id);
      const [created] = await tx.insert(orders).values({
        type: input.type, tableId: input.tableId ?? null,
        customerName: input.customerName || null, customerPhone: input.customerPhone || null,
        deliveryAddress: input.deliveryAddress || null, notes: input.notes || null,
        openedBy: session.id, shiftId, status: "open",
      }).returning();
      oid = created.id;
      await tx.update(orders).set({ orderNo: `E-${1000 + oid}` }).where(eq(orders.id, oid));
    } else {
      const [existing] = await tx.select().from(orders).where(eq(orders.id, oid));
      if (!existing || existing.status !== "open") throw new Error("Order is no longer open.");
      await tx.update(orders).set({
        type: input.type, tableId: input.tableId ?? null,
        customerName: input.customerName || null, customerPhone: input.customerPhone || null,
        deliveryAddress: input.deliveryAddress || null, notes: input.notes || null,
        updatedAt: new Date(),
      }).where(eq(orders.id, oid));
    }

    for (const line of input.lines) {
      const item = items.find((i) => i.id === line.itemId);
      if (!item || !item.active) continue;
      const mods = line.modifierOptionIds
        .map((id) => opts.find((o) => o.id === id))
        .filter((o): o is NonNullable<typeof o> => !!o);
      const unit = item.priceCents + mods.reduce((s, m) => s + m.priceDeltaCents, 0);
      await tx.insert(orderItems).values({
        orderId: oid, itemId: item.id, name: item.name, unitPriceCents: unit,
        qty: line.qty, seat: line.seat,
        modifiers: mods.map((m) => ({ name: m.name, priceCents: m.priceDeltaCents })),
        notes: line.notes || null, status: "fired",
      });
    }
    return oid;
  });

  await recalcOrder(orderId);
  const [ord] = await db.select().from(orders).where(eq(orders.id, orderId));
  await audit(session, "order.send", "order", orderId, { lines: input.lines.length, orderNo: ord?.orderNo });
  return { orderId, orderNo: ord?.orderNo ?? "" };
}

export async function applyDiscount(
  orderId: number, discount: { kind: "percent"; bps: number } | { kind: "fixed"; cents: number } | null,
): Promise<{ error?: string }> {
  const guard = await requirePerm("pos");
  if ("error" in guard) return { error: guard.error };
  const [ord] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!ord || ord.status !== "open") return { error: "Order is not open." };
  if (!discount) {
    await db.update(orders).set({ discountCents: 0, discountLabel: null }).where(eq(orders.id, orderId));
  } else if (discount.kind === "percent") {
    const cents = Math.round((ord.subtotalCents * discount.bps) / 10000);
    await db.update(orders).set({ discountCents: cents, discountLabel: `pct:${discount.bps}` })
      .where(eq(orders.id, orderId));
  } else {
    await db.update(orders).set({ discountCents: discount.cents, discountLabel: "Fixed" })
      .where(eq(orders.id, orderId));
  }
  await recalcOrder(orderId);
  await audit(guard.session, "order.discount", "order", orderId, { discount });
  return {};
}

export async function applyTip(orderId: number, tipCents: number): Promise<{ error?: string }> {
  const guard = await requirePerm("pos");
  if ("error" in guard) return { error: guard.error };
  const [ord] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!ord || ord.status !== "open") return { error: "Order is not open." };
  await db.update(orders).set({ tipCents: Math.max(0, Math.round(tipCents)) }).where(eq(orders.id, orderId));
  await recalcOrder(orderId);
  return {};
}

export async function voidLine(orderItemId: number): Promise<{ error?: string }> {
  const guard = await requirePerm("void");
  if ("error" in guard) return { error: guard.error };
  const [line] = await db.select().from(orderItems).where(eq(orderItems.id, orderItemId));
  if (!line) return { error: "Line not found." };
  if (line.status === "served") return { error: "Cannot void a served line." };
  await db.update(orderItems).set({ status: "voided" }).where(eq(orderItems.id, orderItemId));
  await recalcOrder(line.orderId);
  await audit(guard.session, "order.void_line", "order_item", orderItemId, { name: line.name });
  return {};
}

// ---------------------------------------------------------------------------
// Payments — completing payment triggers FIFO stock deduction + COGS capture
// ---------------------------------------------------------------------------
export async function payOrder(
  orderId: number,
  newPayments: { method: "cash" | "card" | "mobile"; amountCents: number; seat?: number | null }[],
): Promise<{ error?: string; completed?: boolean; dueCents?: number; changeCents?: number }> {
  const guard = await requirePerm("pos");
  if ("error" in guard) return { error: guard.error };
  const { session } = guard;

  const [ord] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!ord || ord.status !== "open") return { error: "Order is not open for payment." };

  const existing = await db.select().from(payments)
    .where(and(eq(payments.orderId, orderId), eq(payments.refunded, false)));
  const paidSoFar = existing.reduce((s, p) => s + p.amountCents, 0);
  const newTotal = newPayments.reduce((s, p) => s + p.amountCents, 0);

  for (const p of newPayments) {
    if (p.amountCents <= 0) return { error: "Payment amounts must be positive." };
    await db.insert(payments).values({
      orderId, method: p.method, amountCents: Math.round(p.amountCents),
      seat: p.seat ?? null, takenBy: session.id,
      reference: p.method === "card" ? `SIM-${Date.now().toString(36).toUpperCase()}` : null,
    });
  }

  const due = ord.totalCents - paidSoFar - newTotal;
  if (due > 0) {
    await audit(session, "payment.partial", "order", orderId, { amount: newTotal });
    return { completed: false, dueCents: due };
  }

  // complete the order + FIFO stock deduction in one transaction
  let cogs = 0;
  try {
    cogs = await db.transaction(async (tx) => {
      const lines = await tx.select().from(orderItems)
        .where(and(eq(orderItems.orderId, orderId), ne(orderItems.status, "voided")));
      let total = 0;
      for (const line of lines) {
        if (!line.itemId) continue;
        for (const src of await lineSources(tx, line.itemId, line.qty)) {
          const recs = await tx.select().from(recipes).where(eq(recipes.itemId, src.itemId));
          for (const r of recs) {
            total += await consumeFifo(tx, r.ingredientId, num(r.qty) * src.mult, "order", orderId, session.id);
          }
        }
      }
      return total;
    });
  } catch (e) {
    console.error(e);
    return { error: "Stock deduction failed — order left open." };
  }

  await db.update(orders).set({
    status: "completed", closedAt: new Date(), updatedAt: new Date(), cogsCents: Math.round(cogs),
  }).where(eq(orders.id, orderId));
  await audit(session, "payment.complete", "order", orderId,
    { orderNo: ord.orderNo, total: ord.totalCents, payments: newPayments.length, cogs: Math.round(cogs) });
  return { completed: true, changeCents: Math.max(0, -due) };
}

export async function voidOrder(orderId: number, reason: string): Promise<{ error?: string }> {
  const guard = await requirePerm("void");
  if ("error" in guard) return { error: guard.error };
  const [ord] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!ord || ord.status !== "open") return { error: "Only open orders can be voided." };
  await db.update(orderItems).set({ status: "voided" })
    .where(and(eq(orderItems.orderId, orderId), ne(orderItems.status, "served")));
  await db.update(orders).set({ status: "voided", refundReason: reason, updatedAt: new Date() })
    .where(eq(orders.id, orderId));
  await audit(guard.session, "order.void", "order", orderId, { reason });
  return {};
}

export async function refundOrder(orderId: number, reason: string): Promise<{ error?: string }> {
  const guard = await requirePerm("refund");
  if ("error" in guard) return { error: guard.error };
  const { session } = guard;
  const [ord] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!ord || ord.status !== "completed") return { error: "Only completed orders can be refunded." };

  await db.transaction(async (tx) => {
    // restock ingredients (FIFO refund layers at weighted-average cost)
    const lines = await tx.select().from(orderItems)
      .where(and(eq(orderItems.orderId, orderId), ne(orderItems.status, "voided")));
    for (const line of lines) {
      if (!line.itemId) continue;
      // combos must be expanded through combo_items — they carry no recipes
      for (const src of await lineSources(tx, line.itemId, line.qty)) {
        const recs = await tx.select().from(recipes).where(eq(recipes.itemId, src.itemId));
        for (const r of recs) {
          const restockQty = num(r.qty) * src.mult;
          const [ing] = await tx.select().from(ingredients).where(eq(ingredients.id, r.ingredientId));
          await addLayer(tx, r.ingredientId, restockQty, num(ing?.avgCostCents),
            "refund_restock", orderId, session.id, `Refund ${ord.orderNo}`, "refund_restock");
          await tx.execute(sql`update ingredients set stock_qty = stock_qty::numeric + ${restockQty.toFixed(3)}::numeric where id = ${r.ingredientId}`);
        }
      }
    }
    await tx.update(payments).set({ refunded: true }).where(eq(payments.orderId, orderId));
    await tx.update(orders).set({
      status: "refunded", refundReason: reason, updatedAt: new Date(),
    }).where(eq(orders.id, orderId));
  });

  await audit(session, "order.refund", "order", orderId, { reason, total: ord.totalCents });
  return {};
}

export async function recentOpenOrders() {
  const session = await getSession();
  if (!session) return [];
  return db.select().from(orders).where(eq(orders.status, "open")).orderBy(desc(orders.createdAt)).limit(20);
}
