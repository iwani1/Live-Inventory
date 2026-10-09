// Food-cost computation: recipe ingredient costs at current weighted-average
// purchase cost vs. menu price. Combos expand through their children.
import { db } from "@/db";
import { sql } from "drizzle-orm";

export type FoodCostRow = {
  id: number; name: string; priceCents: number; recipeCostCents: number;
  foodCostPct: number; marginCents: number; isCombo: boolean;
};

export async function computeMenuCosts(): Promise<FoodCostRow[]> {
  const items = await db.execute(sql`
    select id, name, price_cents, is_combo from menu_items where active order by name
  `).then((r) => r.rows as { id: number; name: string; price_cents: number; is_combo: boolean }[]);

  const recipes = await db.execute(sql`
    select r.item_id, r.ingredient_id, r.qty::float as qty, i.avg_cost_cents::float as cost
    from recipes r join ingredients i on i.id = r.ingredient_id
  `).then((r) => r.rows as { item_id: number; ingredient_id: number; qty: number; cost: number }[]);

  const combos = await db.execute(sql`
    select combo_id, item_id, qty from combo_items
  `).then((r) => r.rows as { combo_id: number; item_id: number; qty: number }[]);

  const costOf = (itemId: number, depth = 0): number => {
    if (depth > 2) return 0;
    const direct = recipes
      .filter((r) => r.item_id === itemId)
      .reduce((s, r) => s + r.qty * r.cost, 0);
    const children = combos
      .filter((c) => c.combo_id === itemId)
      .reduce((s, c) => s + c.qty * costOf(c.item_id, depth + 1), 0);
    return direct + children;
  };

  return items
    .map((i) => {
      const recipeCost = costOf(i.id);
      const margin = i.price_cents - recipeCost;
      return {
        id: i.id, name: i.name, priceCents: i.price_cents,
        recipeCostCents: recipeCost,
        foodCostPct: i.price_cents > 0 ? recipeCost / i.price_cents : 0,
        marginCents: margin, isCombo: i.is_combo,
      };
    })
    .sort((a, b) => b.marginCents - a.marginCents);
}
