#!/usr/bin/env node
/**
 * EMBER POS — end-to-end demo driver.
 *
 * Drives the *running* Next.js app exactly the way a browser does:
 *   PIN login  ->  server actions  ->  /api/export CSVs
 * and after every step asserts against PostgreSQL that the money, the stock
 * and the audit trail are right.
 *
 * Usage:
 *   npm run dev                 # in one terminal (needs DATABASE_URL in .env)
 *   node scripts/demo.mjs       # in another
 *
 * Options: BASE_URL (default http://127.0.0.1:3000)
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = path.resolve(import.meta.dirname, "..");
const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const OUT_DIR = path.join(ROOT, "demo-output");

// ---------------------------------------------------------------------------
// tiny helpers
// ---------------------------------------------------------------------------
const { Pool } = pg;

function loadEnv() {
  const env = {};
  for (const file of [".env.local", ".env"]) {
    const p = path.join(ROOT, file);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return env;
}

const ENV = loadEnv();
const DATABASE_URL = ENV.DATABASE_URL ?? process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not found (.env) — cannot verify the demo.");
  process.exit(1);
}
const pool = new Pool({ connectionString: DATABASE_URL });
const q = async (sql, params) => (await pool.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];

const money = (c) => `${c < 0 ? "-" : ""}$${(Math.abs(Math.round(c)) / 100).toFixed(2)}`;
const n3 = (v) => Number(Number(v ?? 0).toFixed(3));

const checks = [];
function check(name, pass, detail = "") {
  checks.push({ name, pass, detail });
  console.log(`   ${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  return pass;
}

function step(title) {
  console.log(`\n\x1b[1m\x1b[38;5;208m▌ ${title}\x1b[0m`);
}
function say(msg) {
  console.log(`   ${msg}`);
}

// ---------------------------------------------------------------------------
// server-action plumbing
// ---------------------------------------------------------------------------
const MANIFEST_PATHS = [
  ".next/dev/server/server-reference-manifest.json",
  ".next/server/server-reference-manifest.json",
];

function readActionIds() {
  for (const rel of MANIFEST_PATHS) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) continue;
    const manifest = JSON.parse(fs.readFileSync(p, "utf8"));
    const ids = {};
    for (const [id, entry] of Object.entries(manifest.node ?? {})) {
      ids[entry.exportedName] = id;
    }
    return ids;
  }
  throw new Error("server-reference-manifest.json not found — is `next dev` running?");
}

/**
 * Decode the RSC (flight) stream a server action responds with.
 * Row "0" is the flight header; its `a` field points at the row that carries the
 * action result (usually row "1"). That row is streamed twice: first as a
 * deferred reference (`1:D"$49"`) and then as the resolved value (`1:{...}`),
 * or as an error (`1:E{...}`) when the action threw.
 */
function parseActionResponse(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^([0-9a-f]+):([\s\S]*)$/);
    if (m) rows.push({ id: m[1], body: m[2] });
  }
  const header = rows.find((r) => r.id === "0");
  let resultId = "1";
  try {
    const a = header && JSON.parse(header.body).a;
    const ref = typeof a === "string" ? a.match(/^\$@([0-9a-f]+)$/) : null;
    if (ref) resultId = ref[1];
  } catch {
    /* fall back to row 1 */
  }

  let value;
  let error;
  for (const r of rows.filter((x) => x.id === resultId)) {
    if (r.body.startsWith("E")) {
      try {
        const e = JSON.parse(r.body.slice(1));
        error = e.message ?? e.digest ?? "server action failed";
      } catch {
        error = r.body.slice(1);
      }
      continue;
    }
    if (/^[A-Z]/.test(r.body)) continue; // D/I/L/F/H/S/Z — deferred or module ref
    try {
      value = JSON.parse(r.body);
    } catch {
      /* not a value row */
    }
  }
  if (error && !value) value = { error };
  return { value, error };
}

class Browser {
  constructor(label, cookie = "") {
    this.label = label;
    this.cookie = cookie;
  }

  async get(route) {
    const res = await fetch(`${BASE_URL}${route}`, {
      headers: this.cookie ? { cookie: this.cookie } : {},
      redirect: "manual",
    });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    for (const c of setCookie) this.absorb(c);
    return { status: res.status, location: res.headers.get("location"), body: await res.text() };
  }

  absorb(setCookieHeader) {
    const [pair] = setCookieHeader.split(";");
    const idx = pair.indexOf("=");
    const name = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    const jar = new Map();
    for (const c of this.cookie.split(";").map((s) => s.trim()).filter(Boolean)) {
      const i = c.indexOf("=");
      jar.set(c.slice(0, i), c.slice(i + 1));
    }
    if (val) jar.set(name, val);
    else jar.delete(name);
    this.cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  /** Invoke a server action; returns { value, error, http }. */
  async action(name, args, route = "/") {
    let id = ACTION_IDS[name];
    if (!id) {
      ACTION_IDS = readActionIds(); // the page may have just been compiled
      id = ACTION_IDS[name];
    }
    if (!id) throw new Error(`action id for "${name}" not in manifest (page not compiled yet?)`);
    const res = await fetch(`${BASE_URL}${route}`, {
      method: "POST",
      headers: {
        "Next-Action": id,
        "Content-Type": "text/plain;charset=UTF-8",
        Accept: "text/x-component",
        ...(this.cookie ? { cookie: this.cookie } : {}),
      },
      body: JSON.stringify(args),
    });
    for (const c of res.headers.getSetCookie?.() ?? []) this.absorb(c);
    const text = await res.text();
    const parsed = parseActionResponse(text);
    return { ...parsed, http: res.status };
  }
}

// ---------------------------------------------------------------------------
// demo
// ---------------------------------------------------------------------------
let ACTION_IDS = {};
try {
  ACTION_IDS = readActionIds();
} catch {
  // first run: the manifest appears once `next dev` has compiled the pages
}

async function warmUp(adminCookie) {
  const b = new Browser("warmup", adminCookie);
  const routes = ["/login", "/", "/pos", "/kitchen", "/orders", "/tables", "/inventory", "/reports", "/shifts", "/admin/users", "/spec"];
  for (const r of routes) await b.get(r);
  ACTION_IDS = readActionIds();
  if (!Object.keys(ACTION_IDS).length) throw new Error("no server actions found in the manifest");
}

async function login(userId, pin) {
  const anon = new Browser("anon");
  await anon.get("/login"); // makes sure the login worker + action id exist
  const res = await anon.action("loginWithPin", [userId, pin], "/login");
  if (!anon.cookie.includes("ember_session")) {
    throw new Error(`login failed for user ${userId}: ${res.value?.error ?? res.error ?? "no cookie"}`);
  }
  return anon;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log("\x1b[1m\x1b[38;5;208m╔══════════════════════════════════════════════════════════════╗");
  console.log("║        EMBER POS — restaurant POS + live inventory demo       ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\x1b[0m");
  say(`app      ${BASE_URL}`);
  say(`database ${DATABASE_URL.replace(/:[^:@/]*@/, ":****@")}`);
  say(`output   ${path.relative(ROOT, OUT_DIR)}/`);

  // -- 0. health -------------------------------------------------------------
  step("0 · Health & schema");
  const health = await fetch(`${BASE_URL}/api/health`).then((r) => r.json());
  check("GET /api/health", health.ok === true, JSON.stringify(health));

  // the app seeds itself lazily on the first request (src/db/seed.ts) — nudge it
  await new Browser("anon").get("/login");
  for (let i = 0; i < 60; i++) {
    const { c } = await one(`select count(*)::int as c from users`);
    if (c > 0) break;
    await new Promise((r) => setTimeout(r, 500));
    await new Browser("anon").get("/login");
  }

  const tables = await one(
    `select count(*)::int as c from information_schema.tables where table_schema='public'`,
  );
  check("22 tables present", tables.c === 22, `${tables.c} tables`);
  const seeded = await one(
    `select (select count(*)::int from users) u, (select count(*)::int from menu_items) m,
            (select count(*)::int from ingredients) i, (select count(*)::int from recipes) r,
            (select count(*)::int from orders where status='completed') o`,
  );
  say(`seeded: ${seeded.u} staff · ${seeded.m} menu items · ${seeded.i} ingredients · ${seeded.r} recipe lines · ${seeded.o} historical orders`);

  // -- 1. auth + RBAC --------------------------------------------------------
  step("1 · PIN login, sessions & role-based access");
  const staff = await q(`select id, name, role from users order by id`);
  if (!staff.length) throw new Error("no staff rows — the database was never seeded (is the app pointing at this DATABASE_URL?)");
  const PINS = { admin: "0000", manager: "1111", cashier: "2222", cook: "3333", accountant: "4444" };
  const sessions = {};
  for (const u of staff) {
    const b = await login(u.id, PINS[u.role]);
    sessions[u.role] = b;
    const home = await b.get("/");
    say(`${u.name.padEnd(12)} ${u.role.padEnd(11)} PIN ${PINS[u.role]} → session cookie issued, dashboard ${home.status}`);
  }
  check("all 5 roles can sign in with their PIN", Object.keys(sessions).length === 5);

  const badPin = await (async () => {
    const anon = new Browser("anon");
    await anon.get("/login");
    return anon.action("loginWithPin", [staff[0].id, "9999"], "/login");
  })();
  check("wrong PIN is rejected", !!badPin.value?.error, badPin.value?.error);

  const cookAtPos = await sessions.cook.get("/pos");
  check(
    "cook is redirected away from /pos",
    cookAtPos.status >= 300 && cookAtPos.status < 400 && cookAtPos.location === "/",
    `status ${cookAtPos.status} → ${cookAtPos.location}`,
  );
  const anonAtReports = await new Browser("anon").get("/reports");
  if ((ENV.DEMO_AUTOLOGIN ?? "").trim()) {
    check(
      `preview mode (DEMO_AUTOLOGIN=${ENV.DEMO_AUTOLOGIN}) serves cookie-less requests`,
      anonAtReports.status === 200,
      `status ${anonAtReports.status}`,
    );
    say("⚠ DEMO_AUTOLOGIN bypasses the auth gate for iframe previews that refuse cookies — unset it to test the real redirect");
  } else {
    check("anonymous /reports redirects to /login", anonAtReports.location === "/login", `status ${anonAtReports.status}`);
  }
  const cookAtDash = await sessions.cook.get("/");
  say(
    cookAtDash.status === 200
      ? "⚠ RBAC gap: src/app/page.tsx has no can() guard, so a cook can load the revenue dashboard directly"
      : `dashboard is guarded for cook (status ${cookAtDash.status})`,
  );

  // -- 2. baseline -----------------------------------------------------------
  step("2 · Dashboard baseline (before the demo service)");
  const before = await one(
    `select count(*) filter (where status='completed')::int as orders,
            coalesce(sum(total_cents) filter (where status='completed'),0)::int as revenue,
            coalesce(sum(cogs_cents) filter (where status='completed'),0)::int as cogs
     from orders`,
  );
  say(`completed orders ${before.orders} · revenue ${money(before.revenue)} · COGS ${money(before.cogs)}`);

  const admin = sessions.admin;
  await warmUp(admin.cookie);
  ACTION_IDS = readActionIds();
  say(`server actions discovered: ${Object.keys(ACTION_IDS).length}`);

  // -- 3. open a dine-in order ------------------------------------------------
  step("3 · POS: open a dine-in ticket with modifiers (server-priced)");
  const tablesList = await q(`select id, name, seats from restaurant_tables order by id`);
  const table = tablesList.find((t) => t.name === "T5");
  const item = async (name) => one(`select id, name, price_cents, is_combo from menu_items where name=$1`, [name]);
  const opt = async (grp, name) =>
    one(`select o.id, o.name, o.price_delta_cents from modifier_options o join modifier_groups g on g.id=o.group_id where g.name=$1 and o.name=$2`, [grp, name]);

  const burger = await item("Ember Smash Burger");
  const ribeye = await item("Fire-Ribeye 12oz");
  const fries = await item("Truffle Fries");
  const ipa = await item("Local IPA");
  const bacon = await opt("Add-ons", "Smoked Bacon");
  const extraPatty = await opt("Add-ons", "Extra Patty");
  const medRare = await opt("Cook Temperature", "Medium Rare");

  const cart = [
    { itemId: burger.id, qty: 2, seat: 1, modifierOptionIds: [bacon.id, extraPatty.id], notes: "no onions" },
    { itemId: ribeye.id, qty: 1, seat: 1, modifierOptionIds: [medRare.id] },
    { itemId: fries.id, qty: 1, seat: 2, modifierOptionIds: [] },
    { itemId: ipa.id, qty: 2, seat: 2, modifierOptionIds: [] },
  ];
  const expectedSubtotal =
    (burger.price_cents + bacon.price_delta_cents + extraPatty.price_delta_cents) * 2 +
    ribeye.price_cents + fries.price_cents + ipa.price_cents * 2;

  const stockOf = async (name) => one(`select id, name, unit, stock_qty::float as stock, reorder_level::float as reorder, avg_cost_cents::float as cost from ingredients where name=$1`, [name]);
  const watch = ["Beef mince", "Brioche bun", "Cheddar slice", "Ribeye steak", "Butter", "Russet potato", "Truffle oil", "IPA can"];
  const stockBefore = Object.fromEntries((await Promise.all(watch.map(stockOf))).map((r) => [r.name, r]));

  const sent = await admin.action("sendToKitchen", [
    { orderId: null, type: "dine_in", tableId: table.id, notes: "Anniversary — candles on dessert", lines: cart },
  ], "/pos");
  const orderId = sent.value?.orderId;
  check("sendToKitchen created the ticket", !!orderId, sent.value?.orderNo ?? sent.error ?? sent.value?.error ?? "");
  if (!orderId) return summarise();

  const ord = await one(`select * from orders where id=$1`, [orderId]);
  const lines = await q(`select * from order_items where order_id=$1 order by id`, [orderId]);
  say(`${ord.order_no} · table ${table.name} · ${lines.length} lines · shift #${ord.shift_id}`);
  for (const l of lines) {
    const mods = (l.modifiers ?? []).map((m) => `${m.name}${m.priceCents ? ` +${money(m.priceCents)}` : ""}`).join(", ");
    say(`   ${l.qty}× ${l.name.padEnd(20)} ${money(l.unit_price_cents).padStart(8)}  seat ${l.seat}  ${l.status}${mods ? `  [${mods}]` : ""}${l.notes ? `  "${l.notes}"` : ""}`);
  }
  check("line prices = base + modifier deltas (computed server-side)", ord.subtotal_cents === expectedSubtotal, `${money(ord.subtotal_cents)} expected ${money(expectedSubtotal)}`);
  const taxBps = Number((await one(`select value from settings where key='tax_rate_bps'`)).value);
  const expectedTax = Math.round((ord.subtotal_cents * taxBps) / 10000);
  check(`tax @ ${(taxBps / 100).toFixed(2)}%`, ord.tax_cents === expectedTax, `${money(ord.tax_cents)} expected ${money(expectedTax)}`);
  check("ticket is attached to the open shift", ord.shift_id != null, `shift #${ord.shift_id}`);
  check("table is now occupied", (await one(`select count(*)::int c from orders where status='open' and table_id=$1`, [table.id])).c === 1);

  // -- 4. kitchen display ----------------------------------------------------
  step("4 · Kitchen display system (cook bumps the ticket)");
  const kds = await sessions.cook.get("/kitchen");
  check("cook can load /kitchen", kds.status === 200, `status ${kds.status}`);
  check("ticket appears on the KDS board", kds.body.includes(ord.order_no), ord.order_no);
  for (const action of ["start", "ready", "serve"]) {
    const r = await sessions.cook.action("bumpTicket", [orderId, action], "/kitchen");
    const st = (await q(`select distinct status from order_items where order_id=$1`, [orderId])).map((x) => x.status).join(",");
    say(`bumpTicket(${action}) → lines: ${st}${r.value?.error ? ` error: ${r.value.error}` : ""}`);
    check(`KDS ${action}`, !r.value?.error && !r.error, st);
  }

  // -- 5. discount + tip ------------------------------------------------------
  step("5 · Discount, tip and re-pricing");
  await admin.action("applyDiscount", [orderId, { kind: "percent", bps: 1000 }], "/pos");
  await admin.action("applyTip", [orderId, 800], "/pos");
  const after = await one(`select * from orders where id=$1`, [orderId]);
  const expDisc = Math.round((expectedSubtotal * 1000) / 10000);
  const expTotal = expectedSubtotal - expDisc + Math.round(((expectedSubtotal - expDisc) * taxBps) / 10000) + 800;
  say(`10% happy-hour discount ${money(after.discount_cents)} · tip ${money(after.tip_cents)}`);
  check("discount recomputed", after.discount_cents === expDisc, `${money(after.discount_cents)} expected ${money(expDisc)}`);
  check("total = subtotal − discount + tax + tip", after.total_cents === expTotal, `${money(after.total_cents)} expected ${money(expTotal)}`);

  // -- 6. split tender --------------------------------------------------------
  step("6 · Split tender payment (cash partial → card balance)");
  const cashPart = 2000;
  const part = await admin.action("payOrder", [orderId, [{ method: "cash", amountCents: cashPart, seat: 1 }]], "/pos");
  say(`cash ${money(cashPart)} → completed=${!!part.value?.completed} still due ${money(part.value?.dueCents ?? 0)}`);
  check("partial payment leaves the order open", part.value?.completed === false && !!part.value?.dueCents, money(part.value?.dueCents ?? 0));
  const midStatus = (await one(`select status from orders where id=$1`, [orderId])).status;
  check("order still open after partial", midStatus === "open", midStatus);

  const balance = after.total_cents - cashPart;
  const done = await admin.action("payOrder", [orderId, [{ method: "card", amountCents: balance }]], "/pos");
  const paid = await one(`select * from orders where id=$1`, [orderId]);
  const pays = await q(`select method, amount_cents, reference from payments where order_id=$1 order by id`, [orderId]);
  say(`card ${money(balance)} → completed=${!!done.value?.completed} change ${money(done.value?.changeCents ?? 0)}`);
  pays.forEach((p) => say(`   tender: ${p.method.padEnd(6)} ${money(p.amount_cents)}${p.reference ? `  ref ${p.reference}` : ""}`));
  check("order completed on full tender", paid.status === "completed" && !!paid.closed_at, paid.status);
  check("two tenders recorded", pays.length === 2, `${pays.length} payments`);

  // -- 7. FIFO inventory impact ----------------------------------------------
  step("7 · Live inventory: FIFO deduction + COGS captured at payment");
  const expectedUse = await q(
    `select i.name, i.unit, sum(r.qty::float * oi.qty) as used, i.avg_cost_cents::float as cost
     from order_items oi
     join recipes r on r.item_id = oi.item_id
     join ingredients i on i.id = r.ingredient_id
     where oi.order_id = $1 and oi.status <> 'voided'
     group by i.name, i.unit, i.avg_cost_cents
     order by i.name`,
    [orderId],
  );
  let expectedCogs = 0;
  for (const row of expectedUse) {
    const s = await stockOf(row.name);
    const delta = n3(stockBefore[row.name]?.stock - s.stock);
    expectedCogs += row.used * row.cost;
    say(
      `${row.name.padEnd(18)} used ${n3(row.used).toString().padStart(8)} ${row.unit.padEnd(4)} stock ${n3(stockBefore[row.name]?.stock)} → ${n3(s.stock)}` +
        (s.stock <= s.reorder ? `   ⚠ below reorder level (${n3(s.reorder)})` : ""),
    );
    check(`stock deducted: ${row.name}`, Math.abs(delta - row.used) < 0.01, `Δ ${n3(delta)} vs recipe ${n3(row.used)}`);
  }
  check("COGS captured on the order (FIFO cost, not average)", paid.cogs_cents > 0 && Math.abs(paid.cogs_cents - Math.round(expectedCogs)) <= Math.max(2, Math.round(expectedCogs * 0.02)), `${money(paid.cogs_cents)} vs modelled ${money(expectedCogs)}`);
  const moves = await q(`select type, count(*)::int n, sum(qty_delta)::float qty from stock_movements where ref_type='order' and ref_id=$1 group by type`, [orderId]);
  check("stock_movements written for the sale", moves.length > 0 && moves[0].n === expectedUse.length, `${moves[0]?.n ?? 0} movements`);
  const layers = await one(`select count(*)::int as depleted from fifo_layers where qty_remaining::float <= 0`);
  say(`fully consumed FIFO layers so far: ${layers.depleted}`);
  say(`ticket ${money(paid.total_cents)} · COGS ${money(paid.cogs_cents)} · gross margin ${(((paid.total_cents - paid.cogs_cents) / paid.total_cents) * 100).toFixed(1)}%`);

  // -- 8. cash over-pay + change ----------------------------------------------
  step("8 · Takeaway ticket, cash over-tender, then a refund");
  const combo = await item("Burger Combo");
  const lemonade = await item("House Lemonade");
  const takeaway = await admin.action("sendToKitchen", [
    { orderId: null, type: "takeaway", customerName: "Dana Wells", customerPhone: "503-555-0110", lines: [
      { itemId: combo.id, qty: 1, seat: 1, modifierOptionIds: [] },
      { itemId: lemonade.id, qty: 2, seat: 1, modifierOptionIds: [] },
    ] },
  ], "/pos");
  const takeId = takeaway.value?.orderId;
  check("combo ticket created", !!takeId, takeaway.value?.orderNo ?? "");
  const comboChildren = await q(
    `select m.name, ci.qty from combo_items ci join menu_items m on m.id=ci.item_id where ci.combo_id=$1`,
    [combo.id],
  );
  say(`combo "${combo.name}" expands to: ${comboChildren.map((c) => `${c.qty}× ${c.name}`).join(", ")}`);
  const takeTotal = (await one(`select total_cents from orders where id=$1`, [takeId])).total_cents;
  const tender = Math.ceil((takeTotal + 1) / 500) * 500; // round up to the next $5 note
  const cashPay = await admin.action("payOrder", [takeId, [{ method: "cash", amountCents: tender }]], "/pos");
  say(`total ${money(takeTotal)} · cash tendered ${money(tender)} · change due ${money(cashPay.value?.changeCents ?? 0)}`);
  check("change calculated on over-tender", (cashPay.value?.changeCents ?? 0) === tender - takeTotal, money(cashPay.value?.changeCents ?? 0));

  const stockBeforeRefund = await stockOf("Brioche bun");
  const soldMovements = await q(
    `select ingredient_id, sum(qty_delta)::float qty from stock_movements
     where ref_type='order' and ref_id=$1 and type='sale' group by ingredient_id`,
    [takeId],
  );
  const refund = await admin.action("refundOrder", [takeId, "Customer walked out — item unavailable"], "/pos");
  const refunded = await one(`select status, refund_reason from orders where id=$1`, [takeId]);
  const restock = await q(`select type, qty_delta::float qty, ingredient_id from stock_movements where ref_type='refund_restock' and ref_id=$1 order by id`, [takeId]);
  const stockAfterRefund = await stockOf("Brioche bun");
  say(`refund → order ${refunded.status}, ${restock.length} restock movements for ${soldMovements.length} ingredient deductions`);
  check("order marked refunded", refunded.status === "refunded" && !!refunded.refund_reason, refunded.refund_reason);
  check("all tenders flagged refunded", (await one(`select count(*)::int c from payments where order_id=$1 and refunded`, [takeId])).c > 0);
  check(
    "every sold ingredient restocked — including the combo's children",
    restock.length === soldMovements.length &&
      soldMovements.every((s) => restock.some((r) => r.ingredient_id === s.ingredient_id && Math.abs(r.qty + s.qty) < 0.001)),
    `${restock.length} restocks vs ${soldMovements.length} deductions${refund.value?.error ? ` · ${refund.value.error}` : ""}`,
  );
  check("stock level returned after refund", stockAfterRefund.stock > stockBeforeRefund.stock, `Brioche bun ${n3(stockBeforeRefund.stock)} → ${n3(stockAfterRefund.stock)}`);

  // -- 9. voids ---------------------------------------------------------------
  step("9 · Voids (line void + whole-ticket void)");
  const voidTicket = await admin.action("sendToKitchen", [
    { orderId: null, type: "dine_in", tableId: tablesList.find((t) => t.name === "T2").id, lines: [
      { itemId: (await item("Crispy Calamari")).id, qty: 1, seat: 1, modifierOptionIds: [] },
      { itemId: (await item("Chocolate Fondant")).id, qty: 1, seat: 1, modifierOptionIds: [] },
    ] },
  ], "/pos");
  const voidId = voidTicket.value?.orderId;
  const firstLine = (await q(`select id, name from order_items where order_id=$1 order by id`, [voidId]))[0];
  const lv = await admin.action("voidLine", [firstLine.id], "/pos");
  const voidedLine = await one(`select status from order_items where id=$1`, [firstLine.id]);
  say(`void line "${firstLine.name}" → ${voidedLine.status}${lv.value?.error ? ` error: ${lv.value.error}` : ""}`);
  check("line voided", voidedLine.status === "voided", voidedLine.status);
  const repriced = await one(`select subtotal_cents from orders where id=$1`, [voidId]);
  check("ticket re-priced after void", repriced.subtotal_cents === (await item("Chocolate Fondant")).price_cents, money(repriced.subtotal_cents));
  const vo = await admin.action("voidOrder", [voidId, "Guest left before service"], "/pos");
  const voidedOrder = await one(`select status, refund_reason from orders where id=$1`, [voidId]);
  say(`void whole ticket → ${voidedOrder.status} ("${voidedOrder.refund_reason}")`);
  check("ticket voided", voidedOrder.status === "voided" && !vo.value?.error, voidedOrder.status);
  const cookVoid = await sessions.cook.action("voidOrder", [voidId, "cook should not be able to"], "/kitchen");
  check("cook cannot void (RBAC)", !!cookVoid.value?.error, cookVoid.value?.error);

  // -- 10. purchasing ---------------------------------------------------------
  step("10 · Purchasing: drive an ingredient below its reorder level, then replenish it");
  // deterministic across repeated runs: write the target down to 60% of its reorder level
  const target = await one(
    `select id, name, unit, stock_qty::float stock, reorder_level::float reorder
     from ingredients where name = 'Beef mince'`,
  );
  const burn = Math.max(0, Math.round(target.stock - target.reorder * 0.6));
  if (burn > 0) {
    await admin.action("adjustIngredient", [target.id, -burn, "waste", "Demo: trim stock to trigger the reorder alert"], "/inventory");
    say(`wrote off ${burn} ${target.unit} ${target.name} → ${(await stockOf(target.name)).stock} ${target.unit} (reorder level ${n3(target.reorder)})`);
  }
  const low = await q(
    `select i.id, i.name, i.unit, i.stock_qty::float stock, i.reorder_level::float reorder, i.avg_cost_cents::float cost, s.id supplier_id, s.name supplier
     from ingredients i left join suppliers s on s.id=i.supplier_id
     where i.active and i.stock_qty::numeric <= i.reorder_level::numeric order by i.name`,
  );
  say(`low-stock alerts: ${low.map((l) => `${l.name} (${n3(l.stock)} ${l.unit} ≤ ${n3(l.reorder)})`).join(", ") || "none"}`);
  check("reorder-level alerting fires", low.some((l) => l.id === target.id), `${low.length} item(s) flagged`);

  const supplierId = low[0].supplier_id ?? 1;
  const poItems = low.map((l) => ({
    ingredientId: l.id,
    qty: Math.max(1, Math.round((l.reorder * 2 - l.stock) / (l.unit === "g" || l.unit === "ml" ? 500 : 1)) * (l.unit === "g" || l.unit === "ml" ? 500 : 1)),
    unitCostCents: Number((l.cost * 1.04).toFixed(4)), // supplier price up 4%
  }));
  const po = await admin.action("createPO", [{ supplierId, notes: "Demo replenishment order", items: poItems }], "/inventory");
  const poId = po.value?.poId;
  check("purchase order created", !!poId, po.value?.error ?? `PO #${poId}`);
  const poRow = await one(`select status, total_cents from purchase_orders where id=$1`, [poId]);
  say(`PO #${poId} · ${poItems.length} lines · ${money(poRow.total_cents)} · status ${poRow.status}`);
  await admin.action("setPOStatus", [poId, "sent"], "/inventory");
  const beforeReceive = {};
  for (const line of poItems) {
    const row = await one(`select name from ingredients where id=$1`, [line.ingredientId]);
    beforeReceive[row.name] = await stockOf(row.name);
  }
  const rec = await admin.action("receivePO", [poId], "/inventory");
  const poAfter = await one(`select status, received_at from purchase_orders where id=$1`, [poId]);
  check("PO received", poAfter.status === "received" && !!poAfter.received_at && !rec.value?.error, poAfter.status);
  for (const line of await q(
    `select i.name, pi.qty::float qty, pi.unit_cost_cents::float cost from purchase_order_items pi join ingredients i on i.id=pi.ingredient_id where pi.po_id=$1`,
    [poId],
  )) {
    const s = await stockOf(line.name);
    const b = beforeReceive[line.name];
    const expAvg = (b.stock * b.cost + line.qty * line.cost) / (b.stock + line.qty);
    say(`${line.name.padEnd(18)} +${n3(line.qty)} ${s.unit} @ ${line.cost.toFixed(2)}¢ → stock ${n3(b.stock)} → ${n3(s.stock)}, avg cost ${b.cost.toFixed(4)}¢ → ${s.cost.toFixed(4)}¢`);
    check(`stock increased: ${line.name}`, Math.abs(n3(s.stock) - n3(b.stock + line.qty)) < 0.01);
    check(`weighted-average cost recalculated: ${line.name}`, Math.abs(s.cost - expAvg) < 0.01, `${s.cost.toFixed(4)}¢ vs ${expAvg.toFixed(4)}¢`);
    const newLayer = await one(`select qty_remaining::float q, unit_cost_cents::float c from fifo_layers where ingredient_id=$1 order by id desc limit 1`, [s.id]);
    check(`new FIFO cost layer: ${line.name}`, Math.abs(newLayer.q - line.qty) < 0.01 && Math.abs(newLayer.c - line.cost) < 0.001, `${n3(newLayer.q)} @ ${newLayer.c.toFixed(4)}¢`);
  }

  // -- 11. adjustments + waste ------------------------------------------------
  step("11 · Manual stock count correction & waste write-off");
  const wasteTarget = await stockOf("Heirloom tomato");
  const waste = await admin.action("adjustIngredient", [wasteTarget.id, -500, "waste", "Spoiled — walk-in temperature fault"], "/inventory");
  const afterWaste = await stockOf("Heirloom tomato");
  say(`waste 500 g Heirloom tomato → ${n3(wasteTarget.stock)} → ${n3(afterWaste.stock)} g`);
  check("waste deducted + costed via FIFO", Math.abs(n3(wasteTarget.stock - afterWaste.stock) - 500) < 0.01 && !waste.value?.error, waste.value?.error ?? "");
  const corr = await admin.action("adjustIngredient", [wasteTarget.id, 120, "adjustment", "Cycle count correction"], "/inventory");
  const afterCorr = await stockOf("Heirloom tomato");
  check("positive adjustment adds a costed layer", Math.abs(n3(afterCorr.stock - afterWaste.stock) - 120) < 0.01 && !corr.value?.error, `${n3(afterWaste.stock)} → ${n3(afterCorr.stock)}`);
  const cookAdjust = await sessions.cook.action("adjustIngredient", [wasteTarget.id, -100, "waste", "cook should be denied"], "/kitchen");
  check("cook cannot adjust inventory (RBAC)", !!cookAdjust.value?.error, cookAdjust.value?.error);

  // -- 12. timesheets + shift close -------------------------------------------
  step("12 · Timesheets & shift close with cash reconciliation");
  const ci = await sessions.cashier.action("clockIn", [], "/shifts");
  const te = await one(`select id, clock_in, clock_out from time_entries where user_id=$1 order by id desc limit 1`, [staff.find((s) => s.role === "cashier").id]);
  say(`clock in → time entry #${te.id}${ci.value?.error ? ` (${ci.value.error})` : ""}`);
  check("cashier clocked in", te && te.clock_out === null, ci.value?.error ?? "");
  const shift = await one(`select * from shifts where status='open' order by id limit 1`);
  const expectedCash = await one(
    `select coalesce(sum(p.amount_cents),0)::int c from payments p join orders o on o.id=p.order_id
     where o.shift_id=$1 and p.method='cash' and not p.refunded`,
    [shift.id],
  );
  const counted = shift.opening_cash_cents + expectedCash.c - 2500; // drawer is $25 short
  const close = await sessions.cashier.action("closeShift", [counted, "Demo shift close — $25 short in the drawer"], "/shifts");
  const closed = await one(`select * from shifts where id=$1`, [shift.id]);
  say(`shift #${closed.id}: opening ${money(closed.opening_cash_cents)} + cash sales ${money(expectedCash.c)} = expected ${money(closed.expected_cash_cents)}`);
  say(`counted ${money(closed.counted_cash_cents)} → variance ${money(closed.variance_cents)}`);
  check("shift closed with variance", closed.status === "closed" && close.value?.varianceCents === -2500, `variance ${money(closed.variance_cents)}`);
  const co = await sessions.cashier.action("clockOut", [], "/shifts");
  check("cashier clocked out", !co.value?.error, co.value?.error ?? "");
  const reopen = await sessions.cashier.action("openShift", [20000], "/shifts");
  check("a fresh shift can be opened", !reopen.value?.error, reopen.value?.error ?? "");

  // -- 13. reports + exports ---------------------------------------------------
  step("13 · Reports & CSV exports");
  const reports = await sessions.accountant.get("/reports");
  check("accountant can load /reports", reports.status === 200, `status ${reports.status}`);
  const foodCost = await q(
    `select m.name, m.price_cents, coalesce(sum(r.qty::float * i.avg_cost_cents::float),0) as cost
     from menu_items m left join recipes r on r.item_id=m.id left join ingredients i on i.id=r.ingredient_id
     where m.active and not m.is_combo group by m.id, m.name, m.price_cents
     order by (m.price_cents - coalesce(sum(r.qty::float*i.avg_cost_cents::float),0)) desc limit 3`,
  );
  say(`best margins: ${foodCost.map((f) => `${f.name} (${(((f.price_cents - f.cost) / f.price_cents) * 100).toFixed(0)}%)`).join(", ")}`);
  const exportPage = await sessions.accountant.get("/api/export?report=sales&range=14");
  check("export page reachable", exportPage.status === 200);

  for (const report of ["sales", "items", "foodcost", "inventory"]) {
    const res = await fetch(`${BASE_URL}/api/export?report=${report}&range=14`, { headers: { cookie: admin.cookie } });
    const text = await res.text();
    const file = path.join(OUT_DIR, `${report}.csv`);
    fs.writeFileSync(file, text);
    const rows = text.trim().split("\n").length - 1;
    check(`CSV export: ${report}`, res.status === 200 && rows > 0, `${rows} rows → demo-output/${report}.csv`);
    say(`   ${text.trim().split("\n").slice(0, 3).join("\n   ")}`);
  }
  const forbidden = await fetch(`${BASE_URL}/api/export?report=sales`, { headers: { cookie: sessions.cook.cookie } });
  check("cook is forbidden from exports (403)", forbidden.status === 403, `status ${forbidden.status}`);

  // -- 14. receipt -------------------------------------------------------------
  step("14 · Receipt (80mm thermal print view)");
  const receipt = await admin.get(`/receipt/${orderId}`);
  check("receipt renders", receipt.status === 200 && receipt.body.includes(ord.order_no), `status ${receipt.status}`);
  fs.writeFileSync(path.join(OUT_DIR, `receipt-${ord.order_no}.html`), receipt.body);
  say(`saved demo-output/receipt-${ord.order_no}.html`);

  // -- 15. audit trail ----------------------------------------------------------
  step("15 · Audit trail");
  const auditRows = await q(`select user_name, action, entity, entity_id, created_at from audit_logs order by id desc limit 12`);
  for (const a of auditRows.reverse()) {
    say(`${new Date(a.created_at).toISOString().slice(11, 19)}  ${a.user_name.padEnd(12)} ${a.action.padEnd(22)} ${a.entity}${a.entity_id ? ` #${a.entity_id}` : ""}`);
  }
  const auditCount = await one(`select count(*)::int c from audit_logs`);
  check("every mutation is audited", auditCount.c > 20, `${auditCount.c} entries`);

  // -- 16. final numbers --------------------------------------------------------
  step("16 · Post-service snapshot");
  const fin = await one(
    `select count(*) filter (where status='completed')::int completed,
            count(*) filter (where status='open')::int open,
            count(*) filter (where status='refunded')::int refunded,
            count(*) filter (where status='voided')::int voided,
            coalesce(sum(total_cents) filter (where status='completed'),0)::int revenue,
            coalesce(sum(cogs_cents) filter (where status='completed'),0)::int cogs
     from orders`,
  );
  const stockValue = await one(`select sum(stock_qty::float * avg_cost_cents::float)::int v from ingredients where active`);
  say(`orders: ${fin.completed} completed · ${fin.open} open · ${fin.refunded} refunded · ${fin.voided} voided`);
  say(`revenue ${money(fin.revenue)} · COGS ${money(fin.cogs)} · gross margin ${(((fin.revenue - fin.cogs) / fin.revenue) * 100).toFixed(1)}%`);
  say(`inventory on hand ${money(stockValue.v)} across ${(await one(`select count(*)::int c from ingredients where active`)).c} ingredients`);
  say(`demo added ${fin.completed - before.orders} completed order(s), ${money(fin.revenue - before.revenue)} revenue`);
  fs.writeFileSync(
    path.join(OUT_DIR, "summary.json"),
    JSON.stringify({ before, after: fin, checks, generatedAt: new Date().toISOString() }, null, 2),
  );

  return summarise();
}

function summarise() {
  const failed = checks.filter((c) => !c.pass);
  console.log("\n\x1b[1m════════════════════════════════════════════════════════════════\x1b[0m");
  console.log(
    failed.length === 0
      ? `\x1b[1m\x1b[32m  DEMO PASSED — ${checks.length}/${checks.length} checks green\x1b[0m`
      : `\x1b[1m\x1b[31m  DEMO FINISHED WITH ${failed.length} FAILURE(S) out of ${checks.length} checks\x1b[0m`,
  );
  for (const f of failed) console.log(`   ✗ ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
  console.log("\x1b[1m════════════════════════════════════════════════════════════════\x1b[0m\n");
  pool.end();
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("\n\x1b[31mDemo crashed:\x1b[0m", e?.message ?? e);
  if (e?.stack) console.error(e.stack.split("\n").slice(1, 4).join("\n"));
  await pool.end().catch(() => {});
  process.exit(1);
});
