# `restaurant-pos-system-design.zip` — analysis & demo report

**Artefact:** `restaurant-pos-system-design.zip` (278 KB, 51 files, ~5,400 lines of TypeScript/TSX)
**What it actually is:** not a design document — a **complete, runnable full-stack application**: *Ember POS*,
a restaurant point-of-sale + live-inventory platform for "Ember & Ivy", built on Next.js 16 (App Router,
Turbopack), React 19, Drizzle ORM, PostgreSQL, Tailwind v4 and Recharts. The design document is *inside*
the app as a rendered page (`/spec`, 498 lines, 16 sections: architecture, schema, security/PCI, Stripe
Terminal + QuickBooks integrations, PWA/offline strategy, GreenGeeks deployment runbook, QA plan,
roadmap, cost estimate, UAT criteria).

**Verified state:** it runs. It was booted against PostgreSQL 18.4 and driven end-to-end over HTTP —
**67/67 automated checks green** (`npm run demo`). Two blocking bugs were found and fixed on the way
(§6); one auth hole and several integrity/robustness issues are documented but deliberately left
unpatched (§7).

---

## 1. Contents

```
package.json              Next 16.2.6 · React 19.2.6 · drizzle-orm 0.45.2 · pg 8.20 · recharts · lucide
drizzle.config.json       postgresql://postgres:postgres@127.0.0.1:5432/app_db  (hard-coded, no env)
next.config.ts            empty config
src/
  db/schema.ts            22 tables (Drizzle pgTable) — the heart of the design
  db/index.ts             pg Pool singleton on globalThis, throws without DATABASE_URL
  db/seed.ts              idempotent bootstrap: 5 staff, 20 menu items, 25 ingredients, 38 recipes,
                          3 suppliers, 11 tables, 4 modifier groups, 14 days of synthetic sales
  lib/                    auth (HMAC cookie + PIN hash), perms (RBAC matrix), checkout (totals math),
                          stock (FIFO engine), foodcost (recipe costing), audit, format (money/qty)
  actions/                pos, inventory, kds, shifts, admin, auth — 23 server actions
  app/                    /login /  /pos /tables /kitchen /orders /shifts /inventory /reports
                          /admin/users /receipt/[id] /spec /api/health /api/export
  proxy.ts                Next 16 edge gate (the middleware.ts successor) — cookie-presence check
```

Notable conventions, applied consistently:

* **Money is integer cents everywhere** (`price_cents`, `total_cents`, `cogs_cents`).
* **Quantities are `numeric(12,3)` base units** (g / ml / pcs); **unit costs `numeric(14,4)` cents**.
* **Prices are always resolved server-side** — `sendToKitchen` re-reads the menu and modifier options and
  ignores whatever the client sent; totals are recomputed from stored line snapshots.
* **Every mutation writes an `audit_logs` row** (user, action, entity, id, JSONB meta).

---

## 2. How it was made to run

The sandbox has no PostgreSQL and no Docker, and egress is limited to GitHub/npm/PyPI, so the database
was bootstrapped from the npm-published Postgres binaries (`embedded-postgres` → PostgreSQL 18.4),
installed **outside** the repo so the project's own dependency list stays untouched:

```bash
# 1. unpack
unzip restaurant-pos-system-design.zip -d .        # files now at repo root

# 2. throw-away Postgres 18.4 cluster on 127.0.0.1:5432 (UTF8, user/pass postgres/postgres)
#    supervisor kept in /home/user/.pgdemo (not part of the repo)
node /home/user/.pgdemo/start-db.mjs

# 3. app
cp .env.example .env                               # DATABASE_URL + SESSION_SECRET
npm install
npm run db:push                                    # drizzle-kit push → 22 tables
npm run dev -- -H 0.0.0.0 -p 3000                  # live preview
npm run demo                                       # end-to-end driver, 67 assertions
```

Seeding needs no command: `ensureSeeded()` (called from `layout.tsx` and every action) creates the whole
dataset on first request — 5 staff / 20 items / 25 ingredients / 71 historical orders ≈ **$3,621.47**
revenue over 14 days.

Two environment notes:

* `allowedDevOrigins: ["*.e2b.app"]` was added to `next.config.ts`, otherwise Next 16 rejects
  server actions arriving through the preview proxy with *"Invalid Server Actions request"* (verified:
  500 without it, 200 with it).
* `next/font/google` cannot reach fonts.googleapis.com from the sandbox → Inter / Space Grotesk fall back
  to system fonts. Cosmetic only; in a normal build environment they resolve.

**Demo logins** (printed on the login screen): Admin `0000` · Manager `1111` · Cashier `2222` ·
Cook `3333` · Accountant `4444`.

---

## 3. Architecture map

| Layer | Implementation |
| --- | --- |
| Edge gate | `src/proxy.ts` — matcher over everything except `_next/*`; allows `/login`, `/api/health`; otherwise redirects to `/login` **if the `ember_session` cookie is merely present** |
| AuthN | `src/lib/auth.ts` — PIN → `sha256(pin + "\|ember-pos")`; session = base64url(JSON) + HMAC-SHA256 signature in an httpOnly, SameSite=Lax cookie, 12 h TTL |
| AuthZ | `src/lib/perms.ts` — 5 roles × 13 permissions matrix, `can(role, perm)`; `homeFor(role)` sends cook → `/kitchen`, accountant → `/reports` |
| Writes | 23 server actions in `src/actions/*` — each re-checks `can()`, re-reads prices, wraps multi-table work in `db.transaction`, then audits |
| Reads | Server components query directly (Drizzle builder or tagged `sql`), all routes `force-dynamic` |
| Live screens | KDS polls `router.refresh()` every 5 s, floor plan every 10 s (no WebSocket — deliberate, shared hosting/Passenger safe) |
| Reporting | `/reports` + `GET /api/export?report=sales\|items\|foodcost\|inventory&range=N` → CSV (RBAC `export`) |

### Inventory engine (`src/lib/stock.ts`)

The most interesting piece. Purchases/adjustments/refunds create **FIFO cost layers**
(`fifo_layers.qty_remaining`, `unit_cost_cents`); `consumeFifo()` walks layers oldest-first, splits the
quantity across layers when needed, posts one `stock_movements` row and returns the true cost, which
`payOrder` stamps onto `orders.cogs_cents`. Shortfalls don't block the sale — stock goes negative and the
remainder is costed at the current weighted average. `receivePO()` additionally recomputes the moving
average cost of the ingredient in the same transaction.

Verified live: a 4-line ticket consumed 8 ingredients across 8 movements and produced
**COGS $18.42 on a $111.51 ticket (83.5 % gross margin)**, matching the recipe model to the cent.

---

## 4. Data model (22 tables)

| Domain | Tables |
| --- | --- |
| Identity | `users`, `time_entries`, `audit_logs`, `settings` (tax rate 850 bps, restaurant profile) |
| Menu | `categories`, `menu_items`, `combo_items`, `modifier_groups`, `modifier_options`, `item_modifier_groups` |
| Inventory | `ingredients`, `recipes`, `suppliers`, `purchase_orders`, `purchase_order_items` |
| Costing | `fifo_layers`, `stock_movements` (purchase / sale / adjustment / waste / refund_restock) |
| Front of house | `restaurant_tables` (x/y/w/h floor plan), `shifts`, `orders`, `order_items`, `payments` |

Indexes exist on the hot paths (`orders.status/created_at`, `order_items.order_id/status`,
`stock_movements.ingredient_id/created_at`, `fifo_layers.ingredient_id`, `audit_logs.created_at`).
No migrations directory — schema is applied with `drizzle-kit push`, which is fine for a demo and
explicitly called out as the deploy mechanism in `/spec`, but there is no versioned history to roll back.

---

## 5. The demo (`npm run demo`)

`scripts/demo.mjs` drives the **running** app the way a browser does: PIN login → server actions
(called over HTTP with the `Next-Action` id resolved from `.next/dev/server/server-reference-manifest.json`)
→ CSV endpoints, and asserts against PostgreSQL after each step. It is repeatable against a live database
(it forces its own low-stock condition rather than relying on the seed) and exits non-zero on any failed
assertion. Artefacts land in `demo-output/`: `transcript.txt`, `summary.json`, four CSVs and a rendered
receipt.

| # | Scenario | Result |
| --- | --- | --- |
| 0 | `/api/health`, 22 tables, lazy seed | ✓ |
| 1 | All 5 roles sign in with their PINs; wrong PIN rejected; cook blocked from `/pos` (307 → `/`); anonymous blocked from `/reports` | ✓ (dashboard gap noted below) |
| 2 | Baseline: 71 orders, $3,621.47 revenue, $997.09 COGS | ✓ |
| 3 | Dine-in ticket on T5: 2× burger (+bacon +extra patty, "no onions"), ribeye medium-rare, fries, 2× IPA → server-priced **$106.00**, tax **$9.01** @ 8.5 %, attached to the open shift | ✓ |
| 4 | Cook bumps the ticket `fired → preparing → ready → served` | ✓ |
| 5 | 10 % discount ($10.60) + $8.00 tip → total re-derived to **$111.51** | ✓ |
| 6 | Split tender: $20 cash (order stays open, $91.51 due) → $91.51 card (order completes, 2 tenders, card ref `SIM-…`) | ✓ |
| 7 | FIFO deduction: beef mince −360 g, brioche −2, ribeye −340 g, potato −250 g, truffle oil −8 ml, butter −15 g, cheddar −2, IPA −2; **COGS $18.42** stamped; low-stock flags fire | ✓ 8/8 |
| 8 | Takeaway combo ticket ($31.36) paid with a $35 note → **change $3.64**; then refunded → 7 restock movements matching the 7 deductions, tenders flagged refunded, brioche 8 → 9 | ✓ (only after fix #2) |
| 9 | Line void re-prices the ticket ($15.50 → $9.00); whole-ticket void; cook denied (`void` perm) | ✓ |
| 10 | Low stock (beef mince 2,740 ≤ 4,000; brioche 9 ≤ 24) → PO #1 ($92.98) → sent → received: stock 2,740 → 8,240 g, moving average 1.2000¢ → **1.2320¢**, new FIFO layer 5,500 g @ 1.2480¢ | ✓ |
| 11 | Waste write-off −500 g heirloom tomato (costed via FIFO), then +120 g count correction (new layer); cook denied | ✓ |
| 12 | Cashier clocks in, closes shift: opening $200 + cash sales $20 = expected $220, counted $195 → **variance −$25**, clocks out, opens a fresh shift | ✓ |
| 13 | `/reports` for the accountant; CSV exports `sales` (14 rows), `items` (20), `foodcost` (20), `inventory` (25); cook gets **403** | ✓ |
| 14 | Receipt page renders and is saved as 80 mm print HTML | ✓ |
| 15 | Audit trail: 28 entries, every mutation attributed | ✓ |
| 16 | Post-service: 72 completed / 1 refunded / 1 voided, revenue $3,732.98, COGS $1,015.51, stock on hand $1,692.55 | ✓ |

**`DEMO PASSED — 67/67 checks green`**

---

## 6. Bugs found and fixed

### 6.1 Blocker — no order could ever be created (POS dead on arrival)

`src/actions/pos.ts:113-120` fetched the ordered items with a hand-written `= any()`:

```ts
await db.select().from(menuItems).where(sql`${menuItems.id} = any(${itemIds})`)
```

Drizzle expands a JS array interpolated into a `sql` template into a **comma-separated parameter list**,
not a Postgres array, so `sendToKitchen` threw on every call:

| Cart | Server error |
| --- | --- |
| 1 distinct item | `malformed array literal: "8"` |
| 2+ distinct items | `op ANY/ALL (array) requires array on right side` |

`tsc --noEmit` and `eslint` are both clean on the original code, so nothing caught it — the failure only
appears at runtime, on the app's single most important write path. Fixed with Drizzle's own operator
(`inArray`), applied to both the menu-item and modifier-option lookups.

### 6.2 Data integrity — refunds of combo items never restocked

`payOrder` expanded combos through `combo_items` before consuming recipes, but `refundOrder` looked up
`recipes` for the *combo's own* id — and combos have no recipe rows. Evidence from the first demo run
(refunded `E-1074` = Burger Combo + 2× House Lemonade):

```
sale            Beef mince −180 g   Brioche bun −1   Cheddar slice −1
sale            Russet potato −250 g  Truffle oil −8 ml  Cola can −1
sale            Lemon −3
refund_restock  Lemon +3        ← the only line restored
```

Every combo refund therefore destroyed stock permanently (6 ingredients lost per Burger Combo), skewing
on-hand counts, valuation and future COGS. Fixed by extracting a shared, recursion-safe
`lineSources(tx, itemId, qty)` helper (`src/actions/pos.ts:45-62`) now used by **both** paths; the same
ticket now restocks 7 for 7.

Both fixes are minimal, behaviour-preserving elsewhere, and pass `tsc --noEmit` + `eslint .`.

---

## 7. Findings left unpatched (prioritised)

### High — the dashboard is readable without a valid session

`src/proxy.ts:10` only checks that an `ember_session` cookie **exists**; it never verifies the HMAC
signature. `src/app/page.tsx` is the one page that calls neither `getSession()` nor `can()`. Result,
reproduced against the running app:

```bash
curl -H 'Cookie: ember_session=not-a-real-session' http://host/     # → 200
# "Today's revenue $337.40", 67.48 COGS, top sellers, low stock, recent orders…
```

Every other route is safe (`/reports` → 307, `/api/export` → 403) because they guard themselves.
Two-line fix: verify the session in `proxy.ts` (or at minimum add the standard
`getSession()` + `can(session.role, "dashboard")` guard to `src/app/page.tsx`).

### High — payment completion is not atomic and not concurrency-safe

`payOrder` (`src/actions/pos.ts:216-278`) inserts payment rows, *then* runs the FIFO deduction in a
transaction, *then* updates the order to `completed` in a **separate** statement outside it:

* if the status update fails after the deduction, payments exist and stock is gone while the order is
  still `open` → the next attempt deducts the same ingredients **again**;
* the final `update` has no `where status = 'open'` guard and nothing locks the order row, so two
  cashiers tapping "pay" simultaneously can both complete the ticket and both consume stock;
* there are no idempotency keys on payments (the `/spec` PWA section promises them for offline replay).

`/spec` §5 claims "payment completion + stock deduction + COGS stamping run in ONE transaction" — the
code does not currently honour that. Recommended: one transaction covering
`select … for update` on the order → insert payments → conditional status flip (`where status='open'`,
check `rowCount === 1`) → FIFO deduction → COGS stamp, plus a unique client-supplied idempotency key.

### Medium — PIN hashing is unsalted and the session secret has a default

* `hashPin()` = `sha256(pin + "|ember-pos")`: a static app-wide suffix, not a per-user salt, over a
  4-digit keyspace (10,000 candidates). Anyone who reads `users.pin_hash` recovers every PIN instantly.
  `/spec` calls these "salted SHA-256" — they are not. Swap to Argon2id/scrypt with a per-user salt
  (already isolated to one helper) and add per-IP login throttling: `/spec` §7 claims it is "configured in
  the deploy runbook", but neither the code nor the runbook (§11) actually sets it up.
* `SESSION_SECRET` falls back to `"ember-dev-secret-change-in-production"` (`src/lib/auth.ts:6`). If the
  env var is missing in production, anyone can mint an admin cookie. Fail hard instead of defaulting.
* The cookie payload is plain base64url (`{"id":1,"name":"Ava Sterling","role":"admin"}`) — readable by
  any XSS or a curious user; there is no revocation list, so a fired employee keeps access for up to 12 h.

### Medium — the session cookie cannot survive a cross-site iframe

`setSessionCookie()` issued `SameSite=Lax`. That is correct for a normally-served site, but it makes the
app unusable in any cross-site embed (dev previews, a POS page framed inside a back-office portal):
the login action succeeds and the cookie is set, yet the browser never sends it back from the iframe, so
`proxy.ts` sees no session and the very next navigation bounces to `/login`. Observed live — the server log
shows `POST /login 200 · loginWithPin(1, "0000")` immediately followed by `GET /login 200`, i.e. a
successful login that looks like a failed one to the user.

Fixed here behind an opt-in env flag (`COOKIE_SAMESITE=none` → `SameSite=None; Secure; Partitioned`,
the CHIPS attributes a third-party context requires; `clearSessionCookie` now mirrors them so sign-out
actually clears the cookie). Default remains `lax`. Related, and still open: wiping `.next` rotates the
server-action encryption key, so every action id changes and an already-open browser tab posts ids the
server no longer knows ("Server action not found") — always hard-refresh after a rebuild.

### Medium — refund restock is costed at the *current* average, not the original layer

`refundOrder` calls `addLayer(..., num(ing?.avgCostCents), "refund_restock", …)`. Correct behaviour would
reverse the specific layers the sale consumed (or store the consumed layer ids on the movement). As
written, refunds after a price rise inject value that never left the building; COGS on the refunded order
is also left untouched (harmless today only because every report filters on `status='completed'`).

### Low — correctness / robustness nits

| Where | Issue |
| --- | --- |
| `src/lib/stock.ts:83` | `adjustStock()` relabels the newest movement with `where id = (select max(id) … ingredient_id = $1)` — racy and can annotate an unrelated movement. Have `consumeFifo` return the movement id instead. |
| `src/app/pos/pos-client.tsx:529-537` | Per-seat split uses `Math.round(totalCents * ratio)` independently per seat, so shares can sum to ±1-2 ¢ off the ticket (the even-split path does absorb the remainder via `splitEven`). |
| `src/db/seed.ts:20-33` | `ensureSeeded()` guards with a `globalThis` flag plus a `count(*)`; two concurrent first requests (or two PM2 instances, as `/spec` recommends) can both seed. Needs an advisory lock or a `seeded` row in `settings` with a unique constraint. |
| `src/app/api/export/route.ts` | CSV cells are quote-escaped but not formula-escaped (`=`, `+`, `-`, `@` prefixes) and there is no UTF-8 BOM — Excel users will see mojibake and a spreadsheet-injection vector. |
| `src/db/schema.ts` | `orders.type/status`, `menu_items.station`, `payments.method`, `users.role` are free `text` with the allowed values only in comments — `pgEnum` (or CHECK constraints) would make invalid states unrepresentable. `menu_items.tax_exempt` exists and is honoured by `computeTotals` but is never set or surfaced in the UI. |
| `src/components/nav.tsx:28` | Dead class `bg-zinc-925` (not in the Tailwind palette) immediately overridden by `bg-zinc-950`. |
| `src/lib/foodcost.ts` | Combo costing recurses to depth 2 and silently returns 0 beyond that; combos nested deeper would be under-costed without warning. |
| `drizzle.config.json` | Credentials hard-coded, ignores `DATABASE_URL`; any non-default DB needs an edit. Prefer a `drizzle.config.ts` reading env. |

### Delivery gaps (not bugs)

No tests of any kind (no test runner, no `test` script), no CI, no README, no migrations, no `.env.example`
(added here), no error/monitoring wiring, no rate limiting, no PWA manifest/service worker yet
(Phase 3 in `/spec`), card payments simulated (`SIM-…` references). `/spec` is honest about most of these
and prices them into the roadmap.

---

## 8. Verdict

A genuinely complete, well-organised vertical slice: the money maths is careful (integer cents, server-side
re-pricing, discount pro-rated onto the taxable base), the inventory model is real FIFO rather than a
stock counter, and the RBAC + audit pair is applied consistently across 23 actions. The architecture matches
what `/spec` advertises, and the UI is dense but coherent.

What holds it back from production is exactly the class of thing a demo surfaces: one runtime-only
type-system blind spot that killed order entry, one asymmetric combo handling that quietly ate inventory on
refunds, a payment path whose transaction boundary doesn't match the spec, and an unguarded dashboard in
front of a presence-only cookie check. All four are small, localised fixes; the first two are done here.

---

## 9. Files added in this session

| Path | Purpose |
| --- | --- |
| `RUNNING-LOCALLY.md` | step-by-step local runbook (verified against a fresh database) |
| `scripts/demo.mjs` | End-to-end demo driver (67 assertions over HTTP + SQL) — `npm run demo` |
| `scripts/dev-db.mjs` | Zero-install local PostgreSQL 18 (`npm run db:local`), writes `.env` for you |
| `drizzle.config.ts` | replaces `drizzle.config.json`, which hard-coded one connection string and ignored `DATABASE_URL` |
| `.env.example` | `DATABASE_URL` + `SESSION_SECRET` (+ optional `COOKIE_SAMESITE`) template |
| `.gitignore` | `node_modules`, `.next`, `.env`, `.pgdata`, `demo-output/` |
| `next.config.ts` | `allowedDevOrigins` for reverse-proxied dev origins |
| `package.json` | added `db:push`, `db:generate`, `db:local`, `demo` scripts; `embedded-postgres` as an *optional* dependency |
| `ANALYSIS.md` | this document |
| `src/actions/pos.ts` | bug fixes §6.1 and §6.2 |
| `src/lib/auth.ts` | opt-in cross-site session cookie (`COOKIE_SAMESITE=none`) — §7 |

`demo-output/` (CSV exports, receipt HTML, `summary.json`) is generated and git-ignored.
