"use server";

import { db } from "@/db";
import {
  ingredients, suppliers, purchaseOrders, purchaseOrderItems, stockMovements,
} from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/perms";
import { adjustStock, addLayer } from "@/lib/stock";
import { audit } from "@/lib/audit";
import { ensureSeeded } from "@/db/seed";
import { num } from "@/lib/format";

async function guardInventory() {
  await ensureSeeded();
  const session = await getSession();
  if (!session) return { error: "Not signed in" as const };
  if (!can(session.role, "inventory")) return { error: "You don't have inventory permissions." as const };
  return { session };
}

// ---------------------------------------------------------------------------
export async function adjustIngredient(
  ingredientId: number, delta: number, type: "adjustment" | "waste", note: string,
): Promise<{ error?: string }> {
  const guard = await guardInventory();
  if ("error" in guard) return { error: guard.error };
  if (!delta || Number.isNaN(delta)) return { error: "Enter a non-zero quantity." };
  await db.transaction(async (tx) => {
    await adjustStock(tx, ingredientId, delta, note || (delta > 0 ? "Count correction" : "Write-off"), guard.session.id, type);
  });
  await audit(guard.session, `inventory.${type}`, "ingredient", ingredientId, { delta, note });
  return {};
}

export async function saveIngredient(input: {
  id?: number; name: string; unit: string; reorderLevel: number; supplierId?: number | null; avgCostCents?: number;
}): Promise<{ error?: string }> {
  const guard = await guardInventory();
  if ("error" in guard) return { error: guard.error };
  if (!input.name.trim()) return { error: "Name is required." };
  if (input.id) {
    await db.update(ingredients).set({
      name: input.name.trim(), unit: input.unit,
      reorderLevel: input.reorderLevel.toFixed(3), supplierId: input.supplierId ?? null,
    }).where(eq(ingredients.id, input.id));
    await audit(guard.session, "inventory.update", "ingredient", input.id, { name: input.name });
  } else {
    await db.insert(ingredients).values({
      name: input.name.trim(), unit: input.unit, stockQty: "0",
      reorderLevel: input.reorderLevel.toFixed(3), supplierId: input.supplierId ?? null,
      avgCostCents: (input.avgCostCents ?? 0).toFixed(4),
    });
    await audit(guard.session, "inventory.create", "ingredient", null, { name: input.name });
  }
  return {};
}

// ---------------------------------------------------------------------------
export async function saveSupplier(input: {
  id?: number; name: string; contact?: string; email?: string; phone?: string; leadTimeDays?: number; notes?: string;
}): Promise<{ error?: string }> {
  const guard = await guardInventory();
  if ("error" in guard) return { error: guard.error };
  if (!input.name.trim()) return { error: "Name is required." };
  const values = {
    name: input.name.trim(), contact: input.contact || null, email: input.email || null,
    phone: input.phone || null, leadTimeDays: input.leadTimeDays ?? 2, notes: input.notes || null,
  };
  if (input.id) {
    await db.update(suppliers).set(values).where(eq(suppliers.id, input.id));
    await audit(guard.session, "supplier.update", "supplier", input.id, { name: input.name });
  } else {
    await db.insert(suppliers).values(values);
    await audit(guard.session, "supplier.create", "supplier", null, { name: input.name });
  }
  return {};
}

// ---------------------------------------------------------------------------
export async function createPO(input: {
  supplierId: number; notes?: string;
  items: { ingredientId: number; qty: number; unitCostCents: number }[];
}): Promise<{ error?: string; poId?: number }> {
  const guard = await guardInventory();
  if ("error" in guard) return { error: guard.error };
  if (!input.items.length) return { error: "Add at least one line." };
  const total = Math.round(input.items.reduce((s, i) => s + i.qty * i.unitCostCents, 0));
  const [po] = await db.insert(purchaseOrders).values({
    supplierId: input.supplierId, notes: input.notes || null,
    totalCents: total, createdBy: guard.session.id, status: "draft",
  }).returning();
  await db.insert(purchaseOrderItems).values(
    input.items.map((i) => ({
      poId: po.id, ingredientId: i.ingredientId,
      qty: i.qty.toFixed(3), unitCostCents: i.unitCostCents.toFixed(4),
    })),
  );
  await audit(guard.session, "po.create", "purchase_order", po.id, { totalCents: total, lines: input.items.length });
  return { poId: po.id };
}

export async function setPOStatus(poId: number, status: "sent" | "cancelled"): Promise<{ error?: string }> {
  const guard = await guardInventory();
  if ("error" in guard) return { error: guard.error };
  await db.update(purchaseOrders).set({ status }).where(eq(purchaseOrders.id, poId));
  await audit(guard.session, `po.${status}`, "purchase_order", poId, {});
  return {};
}

export async function receivePO(poId: number): Promise<{ error?: string }> {
  const guard = await guardInventory();
  if ("error" in guard) return { error: guard.error };
  const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId));
  if (!po) return { error: "PO not found." };
  if (po.status === "received") return { error: "Already received." };
  if (po.status === "cancelled") return { error: "PO was cancelled." };

  await db.transaction(async (tx) => {
    const lines = await tx.select().from(purchaseOrderItems).where(eq(purchaseOrderItems.poId, poId));
    for (const line of lines) {
      const qty = num(line.qty);
      const cost = num(line.unitCostCents);
      const [ing] = await tx.select().from(ingredients).where(eq(ingredients.id, line.ingredientId));
      if (!ing) continue;
      const oldQty = num(ing.stockQty);
      const oldAvg = num(ing.avgCostCents);
      const newQty = oldQty + qty;
      const newAvg = newQty > 0 ? (oldQty * oldAvg + qty * cost) / newQty : cost;

      await addLayer(tx, line.ingredientId, qty, cost, "purchase", poId, guard.session.id, `PO #${poId}`);
      await tx.update(ingredients)
        .set({ stockQty: newQty.toFixed(3), avgCostCents: newAvg.toFixed(4) })
        .where(eq(ingredients.id, line.ingredientId));
    }
    await tx.update(stockMovements)
      .set({ note: `PO #${poId} received` })
      .where(sql`ref_type = 'purchase' and ref_id = ${poId}`);
    await tx.update(purchaseOrders)
      .set({ status: "received", receivedAt: new Date() })
      .where(eq(purchaseOrders.id, poId));
  });

  await audit(guard.session, "po.receive", "purchase_order", poId, { totalCents: po.totalCents });
  return {};
}
