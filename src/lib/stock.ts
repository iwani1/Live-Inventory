// FIFO inventory engine: layered costing, deductions, restock, receipts.
import { db } from "@/db";
import { fifoLayers, ingredients, stockMovements } from "@/db/schema";
import { asc, eq, sql } from "drizzle-orm";
import { num } from "@/lib/format";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Consume qty base units of an ingredient FIFO. Returns cost in cents (float, aggregated across layers). */
export async function consumeFifo(
  tx: Tx, ingredientId: number, qtyNeeded: number, refType: string, refId: number, userId?: number | null,
): Promise<number> {
  const layers = await tx
    .select()
    .from(fifoLayers)
    .where(eq(fifoLayers.ingredientId, ingredientId))
    .orderBy(asc(fifoLayers.createdAt), asc(fifoLayers.id));

  let remaining = qtyNeeded;
  let costCents = 0;
  for (const layer of layers) {
    if (remaining <= 0) break;
    const available = num(layer.qtyRemaining);
    if (available <= 0) continue;
    const take = Math.min(available, remaining);
    costCents += take * num(layer.unitCostCents);
    await tx
      .update(fifoLayers)
      .set({ qtyRemaining: (available - take).toFixed(3) })
      .where(eq(fifoLayers.id, layer.id));
    remaining -= take;
  }

  if (remaining > 0) {
    // stock shortfall — cost at current weighted average and let stock go negative
    const [ing] = await tx.select().from(ingredients).where(eq(ingredients.id, ingredientId));
    costCents += remaining * num(ing?.avgCostCents);
  }

  await tx.insert(stockMovements).values({
    ingredientId, type: "sale", qtyDelta: (-qtyNeeded).toFixed(3),
    unitCostCents: (costCents / Math.max(qtyNeeded, 0.0001)).toFixed(4),
    refType, refId, userId: userId ?? null, note: "Auto deduction from sale",
  });
  await tx
    .update(ingredients)
    .set({ stockQty: sql`(${ingredients.stockQty}::numeric - ${qtyNeeded.toFixed(3)}::numeric)` })
    .where(eq(ingredients.id, ingredientId));

  return costCents;
}

/** Add a FIFO layer (purchase receipt, positive adjustment, refund restock). */
export async function addLayer(
  tx: Tx, ingredientId: number, qty: number, unitCostCents: number,
  sourceType: string, sourceId: number | null, userId?: number | null, note?: string,
  movementType: string = "purchase",
): Promise<void> {
  await tx.insert(fifoLayers).values({
    ingredientId, qtyRemaining: qty.toFixed(3), unitCostCents: unitCostCents.toFixed(4), sourceType, sourceId,
  });
  await tx.insert(stockMovements).values({
    ingredientId, type: movementType, qtyDelta: qty.toFixed(3),
    unitCostCents: unitCostCents.toFixed(4), refType: sourceType, refId: sourceId,
    userId: userId ?? null, note: note ?? null,
  });
}

/** Manual adjustment: positive -> new layer; negative -> consume FIFO (waste costed). */
export async function adjustStock(
  tx: Tx, ingredientId: number, delta: number, note: string, userId: number, type: "adjustment" | "waste",
): Promise<void> {
  if (delta > 0) {
    const [ing] = await tx.select().from(ingredients).where(eq(ingredients.id, ingredientId));
    await addLayer(tx, ingredientId, delta, num(ing?.avgCostCents), "adjustment", null, userId, note, type);
    await tx.update(ingredients)
      .set({ stockQty: sql`(${ingredients.stockQty}::numeric + ${delta.toFixed(3)}::numeric)` })
      .where(eq(ingredients.id, ingredientId));
  } else if (delta < 0) {
    const qty = Math.abs(delta);
    await consumeFifo(tx, ingredientId, qty, type, 0, userId);
    await tx.update(stockMovements).set({ type, note }).where(
      sql`id = (select max(id) from stock_movements where ingredient_id = ${ingredientId})`,
    );
  }
}
