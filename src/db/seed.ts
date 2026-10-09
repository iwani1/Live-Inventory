// Idempotent bootstrap: seeds the full restaurant dataset on first run.
import { db } from "@/db";
import {
  users, categories, menuItems, comboItems, modifierGroups, modifierOptions,
  itemModifierGroups, ingredients, recipes, suppliers, restaurantTables,
  fifoLayers, stockMovements, settings, shifts, orders, orderItems, payments,
} from "@/db/schema";
import { sql } from "drizzle-orm";
import { hashPin } from "@/lib/auth";

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function ensureSeeded(): Promise<void> {
  const g = globalThis as typeof globalThis & { __emberSeeded?: boolean };
  if (g.__emberSeeded) return;
  g.__emberSeeded = true;
  try {
    const rows = await db.select({ count: sql<number>`count(*)::int` }).from(users);
    if (Number(rows[0]?.count ?? 0) > 0) return;
    await seed();
  } catch (e) {
    g.__emberSeeded = false;
    console.error("[seed] failed:", e);
  }
}

async function seed() {
  // ---- settings ----------------------------------------------------------
  await db.insert(settings).values([
    { key: "restaurant_name", value: "Ember & Ivy" },
    { key: "restaurant_tagline", value: "Modern Fire Kitchen" },
    { key: "address", value: "117 Coal Avenue, Portland OR" },
    { key: "tax_rate_bps", value: "850" }, // 8.5%
    { key: "currency", value: "USD" },
  ]);

  // ---- users --------------------------------------------------------------
  const staff = await db.insert(users).values([
    { name: "Ava Sterling", pinHash: hashPin("0000"), role: "admin" },
    { name: "Marco Reyes", pinHash: hashPin("1111"), role: "manager" },
    { name: "Casey Chen", pinHash: hashPin("2222"), role: "cashier" },
    { name: "Kofi Mensah", pinHash: hashPin("3333"), role: "cook" },
    { name: "Priya Nair", pinHash: hashPin("4444"), role: "accountant" },
  ]).returning();
  const [admin, manager, cashier] = staff;

  // ---- suppliers ----------------------------------------------------------
  const sups = await db.insert(suppliers).values([
    { name: "Prime Meats Co.", contact: "Dana Wells", email: "orders@primemeats.example", phone: "503-555-0110", leadTimeDays: 2 },
    { name: "Willamette Produce", contact: "Luis Ortega", email: "sales@willamette.example", phone: "503-555-0128", leadTimeDays: 1 },
    { name: "Northwest Provisions", contact: "Sam Kim", email: "hello@nwprov.example", phone: "503-555-0144", leadTimeDays: 3 },
  ]).returning();
  const [prime, produce, prov] = sups;

  // ---- ingredients (unit costs are cents per base unit) -------------------
  // [name, unit, stock, reorder, avgCostCents, supplierIdx]
  const ingDefs: [string, string, number, number, number, number][] = [
    ["Ribeye steak", "g", 12000, 3000, 2.2, 0],
    ["Salmon fillet", "g", 8000, 2000, 1.8, 0],
    ["Whole chicken", "pcs", 24, 6, 650, 0],
    ["Beef mince", "g", 3100, 4000, 1.2, 0],   // LOW STOCK demo
    ["Smoked bacon", "g", 4000, 1000, 1.6, 0],
    ["Brioche bun", "pcs", 11, 24, 60, 2],     // LOW STOCK demo
    ["Cheddar slice", "pcs", 100, 30, 25, 2],
    ["Free-range egg", "pcs", 90, 30, 35, 2],
    ["Butter", "g", 8000, 1500, 1.2, 2],
    ["Whole milk", "ml", 8000, 2000, 0.15, 2],
    ["Russet potato", "g", 30000, 8000, 0.2, 1],
    ["Truffle oil", "ml", 900, 200, 8, 1],
    ["Broccolini", "g", 5000, 1500, 0.6, 1],
    ["Corn cob", "pcs", 40, 12, 80, 1],
    ["Arborio rice", "g", 10000, 2000, 0.35, 1],
    ["Mixed mushrooms", "g", 6000, 1200, 1.1, 1],
    ["Calamari tubes", "g", 4200, 1000, 1.4, 1],
    ["Burrata", "pcs", 18, 6, 320, 1],
    ["Heirloom tomato", "g", 7000, 1500, 0.5, 1],
    ["Cream cheese", "g", 3000, 800, 0.9, 2],
    ["Dark chocolate 70%", "g", 5000, 1000, 1.5, 2],
    ["Lemon", "pcs", 60, 20, 40, 1],
    ["Cola can", "pcs", 48, 12, 90, 2],
    ["IPA can", "pcs", 60, 24, 180, 2],
    ["Cold-brew beans", "g", 2500, 600, 2.4, 2],
  ];
  const ingRows = await db.insert(ingredients).values(
    ingDefs.map(([name, unit, stock, reorder, cost, s]) => ({
      name, unit, stockQty: String(stock), reorderLevel: String(reorder),
      avgCostCents: String(cost), supplierId: sups[s].id,
    })),
  ).returning();

  // one FIFO seed layer per ingredient
  await db.insert(fifoLayers).values(
    ingRows.map((r, i) => ({
      ingredientId: r.id, qtyRemaining: ingDefs[i][2].toFixed(3),
      unitCostCents: String(ingDefs[i][4]), sourceType: "seed" as const,
    })),
  );
  await db.insert(stockMovements).values(
    ingRows.map((r, i) => ({
      ingredientId: r.id, type: "adjustment", qtyDelta: ingDefs[i][2].toFixed(3),
      unitCostCents: String(ingDefs[i][4]), refType: "seed", note: "Opening stock",
    })),
  );

  const ingId = (name: string) => ingRows[ingDefs.findIndex((d) => d[0] === name)].id;

  // ---- categories + menu items -------------------------------------------
  const cats = await db.insert(categories).values([
    { name: "Small Plates", sort: 1 }, { name: "Mains", sort: 2 },
    { name: "Burgers & Sandos", sort: 3 }, { name: "Sides", sort: 4 },
    { name: "Desserts", sort: 5 }, { name: "Drinks", sort: 6 },
  ]).returning();
  const catId = (n: string) => cats.find((c) => c.name === n)!.id;

  const itemDefs: [string, string, number, string, string][] = [
    // [name, category, price, color, station]
    ["Charred Corn Ribs", "Small Plates", 950, "amber", "kitchen"],
    ["Crispy Calamari", "Small Plates", 1250, "amber", "kitchen"],
    ["Burrata & Ember Tomatoes", "Small Plates", 1400, "amber", "kitchen"],
    ["Fire-Ribeye 12oz", "Mains", 3850, "red", "kitchen"],
    ["Cedar Salmon", "Mains", 2650, "red", "kitchen"],
    ["Smoked Half Chicken", "Mains", 2250, "red", "kitchen"],
    ["Wild Mushroom Risotto", "Mains", 1950, "red", "kitchen"],
    ["Ember Smash Burger", "Burgers & Sandos", 1550, "orange", "kitchen"],
    ["Fried Chicken Sando", "Burgers & Sandos", 1450, "orange", "kitchen"],
    ["Truffle Fries", "Sides", 850, "yellow", "kitchen"],
    ["Charred Broccolini", "Sides", 750, "yellow", "kitchen"],
    ["Mac & Cheese Bake", "Sides", 900, "yellow", "kitchen"],
    ["Basque Cheesecake", "Desserts", 850, "pink", "kitchen"],
    ["Chocolate Fondant", "Desserts", 900, "pink", "kitchen"],
    ["House Lemonade", "Drinks", 450, "sky", "bar"],
    ["Craft Cola", "Drinks", 400, "sky", "bar"],
    ["Cold Brew", "Drinks", 500, "sky", "bar"],
    ["Local IPA", "Drinks", 750, "sky", "bar"],
    ["Burger Combo", "Burgers & Sandos", 1990, "orange", "kitchen"],
    ["Family Feast", "Mains", 4290, "red", "kitchen"],
  ];
  const itemRows = await db.insert(menuItems).values(
    itemDefs.map(([name, cat, price, color, station]) => ({
      name, categoryId: catId(cat), priceCents: price, color, station,
      isCombo: name === "Burger Combo" || name === "Family Feast",
    })),
  ).returning();
  const itemId = (n: string) => itemRows.find((r) => r.name === n)!.id;

  await db.insert(comboItems).values([
    { comboId: itemId("Burger Combo"), itemId: itemId("Ember Smash Burger"), qty: 1 },
    { comboId: itemId("Burger Combo"), itemId: itemId("Truffle Fries"), qty: 1 },
    { comboId: itemId("Burger Combo"), itemId: itemId("Craft Cola"), qty: 1 },
    { comboId: itemId("Family Feast"), itemId: itemId("Smoked Half Chicken"), qty: 1 },
    { comboId: itemId("Family Feast"), itemId: itemId("Truffle Fries"), qty: 1 },
    { comboId: itemId("Family Feast"), itemId: itemId("Charred Broccolini"), qty: 1 },
    { comboId: itemId("Family Feast"), itemId: itemId("Craft Cola"), qty: 2 },
  ]);

  // ---- recipes (ingredient-level) ----------------------------------------
  const rf = (item: string, list: [string, number][]) =>
    list.map(([ing, q]) => ({ itemId: itemId(item), ingredientId: ingId(ing), qty: q.toFixed(3) }));
  await db.insert(recipes).values([
    ...rf("Fire-Ribeye 12oz", [["Ribeye steak", 340], ["Butter", 15]]),
    ...rf("Cedar Salmon", [["Salmon fillet", 200], ["Butter", 10], ["Lemon", 0.5]]),
    ...rf("Smoked Half Chicken", [["Whole chicken", 0.5], ["Butter", 10]]),
    ...rf("Wild Mushroom Risotto", [["Arborio rice", 120], ["Mixed mushrooms", 150], ["Butter", 20]]),
    ...rf("Ember Smash Burger", [["Beef mince", 180], ["Brioche bun", 1], ["Cheddar slice", 1]]),
    ...rf("Fried Chicken Sando", [["Whole chicken", 0.28], ["Brioche bun", 1], ["Cheddar slice", 1]]),
    ...rf("Truffle Fries", [["Russet potato", 250], ["Truffle oil", 8]]),
    ...rf("Charred Broccolini", [["Broccolini", 200], ["Butter", 10]]),
    ...rf("Mac & Cheese Bake", [["Cheddar slice", 3], ["Whole milk", 150], ["Butter", 15]]),
    ...rf("Charred Corn Ribs", [["Corn cob", 2], ["Butter", 10]]),
    ...rf("Crispy Calamari", [["Calamari tubes", 180]]),
    ...rf("Burrata & Ember Tomatoes", [["Burrata", 1], ["Heirloom tomato", 150]]),
    ...rf("Basque Cheesecake", [["Cream cheese", 120], ["Free-range egg", 1]]),
    ...rf("Chocolate Fondant", [["Dark chocolate 70%", 90], ["Butter", 30], ["Free-range egg", 2]]),
    ...rf("House Lemonade", [["Lemon", 1.5]]),
    ...rf("Craft Cola", [["Cola can", 1]]),
    ...rf("Cold Brew", [["Cold-brew beans", 20], ["Whole milk", 50]]),
    ...rf("Local IPA", [["IPA can", 1]]),
  ]);

  // ---- modifiers ----------------------------------------------------------
  const [cookTemp, addOns, drinkSize, dips] = await db.insert(modifierGroups).values([
    { name: "Cook Temperature", required: true, min: 1, max: 1 },
    { name: "Add-ons", required: false, min: 0, max: 4 },
    { name: "Size", required: true, min: 1, max: 1 },
    { name: "Dips", required: false, min: 0, max: 2 },
  ]).returning();

  await db.insert(modifierOptions).values([
    { groupId: cookTemp.id, name: "Rare", priceDeltaCents: 0 },
    { groupId: cookTemp.id, name: "Medium Rare", priceDeltaCents: 0 },
    { groupId: cookTemp.id, name: "Medium", priceDeltaCents: 0 },
    { groupId: cookTemp.id, name: "Medium Well", priceDeltaCents: 0 },
    { groupId: cookTemp.id, name: "Well Done", priceDeltaCents: 0 },
    { groupId: addOns.id, name: "Aged Cheddar", priceDeltaCents: 150 },
    { groupId: addOns.id, name: "Smoked Bacon", priceDeltaCents: 200 },
    { groupId: addOns.id, name: "Fried Egg", priceDeltaCents: 150 },
    { groupId: addOns.id, name: "Avocado", priceDeltaCents: 200 },
    { groupId: addOns.id, name: "Extra Patty", priceDeltaCents: 450 },
    { groupId: addOns.id, name: "Gluten-free Bun", priceDeltaCents: 100 },
    { groupId: drinkSize.id, name: "Regular", priceDeltaCents: 0 },
    { groupId: drinkSize.id, name: "Large", priceDeltaCents: 100 },
    { groupId: dips.id, name: "Chipotle Mayo", priceDeltaCents: 75 },
    { groupId: dips.id, name: "Truffle Aioli", priceDeltaCents: 100 },
  ]);

  await db.insert(itemModifierGroups).values([
    { itemId: itemId("Fire-Ribeye 12oz"), groupId: cookTemp.id },
    { itemId: itemId("Ember Smash Burger"), groupId: addOns.id },
    { itemId: itemId("Fried Chicken Sando"), groupId: addOns.id },
    { itemId: itemId("House Lemonade"), groupId: drinkSize.id },
    { itemId: itemId("Craft Cola"), groupId: drinkSize.id },
    { itemId: itemId("Cold Brew"), groupId: drinkSize.id },
    { itemId: itemId("Truffle Fries"), groupId: dips.id },
    { itemId: itemId("Charred Corn Ribs"), groupId: dips.id },
  ]);

  // ---- floor plan ----------------------------------------------------------
  await db.insert(restaurantTables).values([
    { name: "T1", seats: 2, x: 5, y: 8, w: 12, h: 16, shape: "rect" },
    { name: "T2", seats: 2, x: 21, y: 8, w: 12, h: 16, shape: "rect" },
    { name: "T3", seats: 4, x: 38, y: 6, w: 15, h: 18, shape: "rect" },
    { name: "T4", seats: 4, x: 57, y: 6, w: 15, h: 18, shape: "rect" },
    { name: "T5", seats: 6, x: 76, y: 10, w: 17, h: 22, shape: "rect" },
    { name: "T6", seats: 8, x: 38, y: 40, w: 20, h: 24, shape: "rect" },
    { name: "T7", seats: 4, x: 66, y: 46, w: 13, h: 18, shape: "rect" },
    { name: "T8", seats: 4, x: 9, y: 42, w: 13, h: 18, shape: "rect" },
    { name: "B1", seats: 2, x: 5, y: 74, w: 8, h: 12, shape: "round" },
    { name: "B2", seats: 2, x: 16, y: 74, w: 8, h: 12, shape: "round" },
    { name: "B3", seats: 2, x: 27, y: 74, w: 8, h: 12, shape: "round" },
  ]);

  // ---- open shift ----------------------------------------------------------
  await db.insert(shifts).values({
    userId: cashier.id, openingCashCents: 20000, status: "open",
  });

  // ---- 14 days of historical completed orders ------------------------------
  const rand = mulberry32(42);
  const taxBps = 850;
  const sellable = itemRows.filter((i) => !i.name.includes("IPA"));
  const now = Date.now();
  const toInsertOrders: (typeof orders.$inferInsert)[] = [];
  const orderDates: Date[] = [];

  for (let d = 13; d >= 0; d--) {
    const perDay = 3 + Math.floor(rand() * 4);
    for (let i = 0; i < perDay; i++) {
      const created = new Date(now - d * 86400000);
      created.setHours(11 + Math.floor(rand() * 10), Math.floor(rand() * 59), 0, 0);
      orderDates.push(created);
      toInsertOrders.push({
        orderNo: "", type: rand() < 0.55 ? "dine_in" : rand() < 0.5 ? "takeaway" : "delivery",
        status: "completed", openedBy: cashier.id,
        createdAt: created, updatedAt: created, closedAt: created,
      });
    }
  }
  const insertedOrders = await db.insert(orders).values(toInsertOrders).returning();

  for (let o = 0; o < insertedOrders.length; o++) {
    const ord = insertedOrders[o];
    const lines = 1 + Math.floor(rand() * 3);
    const chosen: typeof sellable = [];
    for (let l = 0; l < lines; l++) {
      const it = sellable[Math.floor(rand() * sellable.length)];
      if (!chosen.includes(it)) chosen.push(it);
    }
    let subtotal = 0;
    const oiRows: (typeof orderItems.$inferInsert)[] = chosen.map((it, idx) => {
      const q = 1 + Math.floor(rand() * 2);
      subtotal += it.priceCents * q;
      return {
        orderId: ord.id, itemId: it.id, name: it.name, unitPriceCents: it.priceCents,
        qty: q, seat: 1, modifiers: [], status: "served", createdAt: orderDates[o],
      };
    });
    const tax = Math.round((subtotal * taxBps) / 10000);
    const tip = rand() < 0.55 ? Math.round(subtotal * 0.15) : 0;
    const total = subtotal + tax + tip;
    const cogs = Math.round(subtotal * (0.28 + rand() * 0.08)); // modeled historical COGS
    await db.insert(orderItems).values(oiRows);
    await db.update(orders).set({
      orderNo: `E-${1000 + ord.id}`,
      subtotalCents: subtotal, taxCents: tax, tipCents: tip, totalCents: total, cogsCents: cogs,
    }).where(sql`${orders.id} = ${ord.id}`);
    await db.insert(payments).values({
      orderId: ord.id, method: rand() < 0.58 ? "card" : "cash",
      amountCents: total, tipCents: tip, takenBy: cashier.id, createdAt: orderDates[o],
    });
  }

  // audit trail first entry
  await db.execute(
    sql`insert into audit_logs (user_id, user_name, action, entity, entity_id, meta) values (${admin.id}, ${admin.name}, 'seed', 'system', 'bootstrap', ${JSON.stringify({ by: "ensureSeeded" })}::jsonb)`,
  );
  console.log(`[seed] complete: ${insertedOrders.length} historical orders created`);
}
