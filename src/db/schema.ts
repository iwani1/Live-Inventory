// ============================================================================
// EMBER — Restaurant POS + Inventory Platform
// PostgreSQL schema (Drizzle ORM)
// Money is stored as integer cents. Quantities as numeric(12,3) base units.
// ============================================================================
import {
  pgTable, serial, text, integer, boolean, timestamp, numeric, jsonb, index,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Users, roles, timesheets, audit
// ---------------------------------------------------------------------------
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  pinHash: text("pin_hash").notNull(),
  role: text("role").notNull(), // admin | manager | cashier | cook | accountant
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const timeEntries = pgTable("time_entries", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  clockIn: timestamp("clock_in", { withTimezone: true }).notNull().defaultNow(),
  clockOut: timestamp("clock_out", { withTimezone: true }),
});

export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  userName: text("user_name"),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id"),
  meta: jsonb("meta").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("audit_created_idx").on(t.createdAt)]);

// ---------------------------------------------------------------------------
// Menu: categories, items, combos, modifiers, recipes
// ---------------------------------------------------------------------------
export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  sort: integer("sort").notNull().default(0),
});

export const menuItems = pgTable("menu_items", {
  id: serial("id").primaryKey(),
  categoryId: integer("category_id").notNull().references(() => categories.id),
  name: text("name").notNull(),
  priceCents: integer("price_cents").notNull(),
  taxExempt: boolean("tax_exempt").notNull().default(false),
  active: boolean("active").notNull().default(true),
  isCombo: boolean("is_combo").notNull().default(false),
  station: text("station").notNull().default("kitchen"), // kitchen | bar
  color: text("color").notNull().default("zinc"),
});

export const comboItems = pgTable("combo_items", {
  id: serial("id").primaryKey(),
  comboId: integer("combo_id").notNull().references(() => menuItems.id),
  itemId: integer("item_id").notNull().references(() => menuItems.id),
  qty: integer("qty").notNull().default(1),
});

export const modifierGroups = pgTable("modifier_groups", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  required: boolean("required").notNull().default(false),
  min: integer("min").notNull().default(0),
  max: integer("max").notNull().default(1),
});

export const modifierOptions = pgTable("modifier_options", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull().references(() => modifierGroups.id),
  name: text("name").notNull(),
  priceDeltaCents: integer("price_delta_cents").notNull().default(0),
});

export const itemModifierGroups = pgTable("item_modifier_groups", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id").notNull().references(() => menuItems.id),
  groupId: integer("group_id").notNull().references(() => modifierGroups.id),
});

export const ingredients = pgTable("ingredients", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  unit: text("unit").notNull().default("pcs"), // g | ml | pcs | kg | l
  stockQty: numeric("stock_qty", { precision: 12, scale: 3 }).notNull().default("0"),
  reorderLevel: numeric("reorder_level", { precision: 12, scale: 3 }).notNull().default("0"),
  avgCostCents: numeric("avg_cost_cents", { precision: 14, scale: 4 }).notNull().default("0"),
  supplierId: integer("supplier_id").references(() => suppliers.id),
  active: boolean("active").notNull().default(true),
});

export const recipes = pgTable("recipes", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id").notNull().references(() => menuItems.id),
  ingredientId: integer("ingredient_id").notNull().references(() => ingredients.id),
  qty: numeric("qty", { precision: 12, scale: 3 }).notNull(), // base units per 1 serving
});

// ---------------------------------------------------------------------------
// Inventory: suppliers, purchase orders, stock movements, FIFO cost layers
// ---------------------------------------------------------------------------
export const suppliers = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  contact: text("contact"),
  email: text("email"),
  phone: text("phone"),
  leadTimeDays: integer("lead_time_days").notNull().default(2),
  notes: text("notes"),
});

export const purchaseOrders = pgTable("purchase_orders", {
  id: serial("id").primaryKey(),
  supplierId: integer("supplier_id").notNull().references(() => suppliers.id),
  status: text("status").notNull().default("draft"), // draft | sent | received | cancelled
  notes: text("notes"),
  totalCents: integer("total_cents").notNull().default(0),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  receivedAt: timestamp("received_at", { withTimezone: true }),
});

export const purchaseOrderItems = pgTable("purchase_order_items", {
  id: serial("id").primaryKey(),
  poId: integer("po_id").notNull().references(() => purchaseOrders.id),
  ingredientId: integer("ingredient_id").notNull().references(() => ingredients.id),
  qty: numeric("qty", { precision: 12, scale: 3 }).notNull(),
  unitCostCents: numeric("unit_cost_cents", { precision: 14, scale: 4 }).notNull(),
});

export const stockMovements = pgTable("stock_movements", {
  id: serial("id").primaryKey(),
  ingredientId: integer("ingredient_id").notNull().references(() => ingredients.id),
  type: text("type").notNull(), // purchase | sale | adjustment | waste | refund_restock
  qtyDelta: numeric("qty_delta", { precision: 12, scale: 3 }).notNull(),
  unitCostCents: numeric("unit_cost_cents", { precision: 14, scale: 4 }).notNull().default("0"),
  refType: text("ref_type"),
  refId: integer("ref_id"),
  note: text("note"),
  userId: integer("user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("stock_moves_ing_idx").on(t.ingredientId), index("stock_moves_created_idx").on(t.createdAt)]);

export const fifoLayers = pgTable("fifo_layers", {
  id: serial("id").primaryKey(),
  ingredientId: integer("ingredient_id").notNull().references(() => ingredients.id),
  qtyRemaining: numeric("qty_remaining", { precision: 12, scale: 3 }).notNull(),
  unitCostCents: numeric("unit_cost_cents", { precision: 14, scale: 4 }).notNull(),
  sourceType: text("source_type").notNull().default("seed"), // seed | purchase | adjustment | refund_restock
  sourceId: integer("source_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("fifo_ing_idx").on(t.ingredientId)]);

// ---------------------------------------------------------------------------
// Front of house: tables, shifts, orders, order items, payments
// ---------------------------------------------------------------------------
export const restaurantTables = pgTable("restaurant_tables", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  seats: integer("seats").notNull().default(4),
  x: integer("x").notNull().default(0),
  y: integer("y").notNull().default(0),
  w: integer("w").notNull().default(120),
  h: integer("h").notNull().default(90),
  shape: text("shape").notNull().default("rect"), // rect | round
});

export const shifts = pgTable("shifts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  openingCashCents: integer("opening_cash_cents").notNull().default(0),
  expectedCashCents: integer("expected_cash_cents"),
  countedCashCents: integer("counted_cash_cents"),
  varianceCents: integer("variance_cents"),
  status: text("status").notNull().default("open"), // open | closed
  notes: text("notes"),
});

export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  orderNo: text("order_no").notNull().default(""),
  type: text("type").notNull().default("dine_in"), // dine_in | takeaway | delivery
  tableId: integer("table_id").references(() => restaurantTables.id),
  status: text("status").notNull().default("open"), // open | completed | voided | refunded
  subtotalCents: integer("subtotal_cents").notNull().default(0),
  discountCents: integer("discount_cents").notNull().default(0),
  discountLabel: text("discount_label"),
  taxCents: integer("tax_cents").notNull().default(0),
  tipCents: integer("tip_cents").notNull().default(0),
  totalCents: integer("total_cents").notNull().default(0),
  cogsCents: integer("cogs_cents").notNull().default(0),
  customerName: text("customer_name"),
  customerPhone: text("customer_phone"),
  deliveryAddress: text("delivery_address"),
  notes: text("notes"),
  openedBy: integer("opened_by").references(() => users.id),
  shiftId: integer("shift_id").references(() => shifts.id),
  refundReason: text("refund_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
}, (t) => [index("orders_created_idx").on(t.createdAt), index("orders_status_idx").on(t.status)]);

export const orderItems = pgTable("order_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => orders.id),
  itemId: integer("item_id").references(() => menuItems.id),
  name: text("name").notNull(),
  unitPriceCents: integer("unit_price_cents").notNull(), // base + modifiers (snapshot)
  qty: integer("qty").notNull(),
  seat: integer("seat").notNull().default(1),
  modifiers: jsonb("modifiers").$type<{ name: string; priceCents: number }[]>().notNull(),
  notes: text("notes"),
  status: text("status").notNull().default("fired"), // fired | preparing | ready | served | voided
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("order_items_order_idx").on(t.orderId), index("order_items_status_idx").on(t.status)]);

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => orders.id),
  method: text("method").notNull(), // cash | card | mobile
  amountCents: integer("amount_cents").notNull(),
  tipCents: integer("tip_cents").notNull().default(0),
  seat: integer("seat"),
  reference: text("reference"),
  refunded: boolean("refunded").notNull().default(false),
  takenBy: integer("taken_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("payments_order_idx").on(t.orderId)]);

// ---------------------------------------------------------------------------
// Key/value settings (tax rate, restaurant profile, order sequence)
// ---------------------------------------------------------------------------
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

// Re-export types used across the app
export type User = typeof users.$inferSelect;
export type MenuItem = typeof menuItems.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type Ingredient = typeof ingredients.$inferSelect;
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type RestaurantTable = typeof restaurantTables.$inferSelect;
export type Shift = typeof shifts.$inferSelect;
