# Coverage audit — Ember POS vs. your master prompt

**Method:** every bullet in your 24 sections was counted as one requirement, then checked against the
actual code (routes, schema columns, actions, UI components) — not against the in-app `/spec` page, which
describes intent. "Met" means working and verified in the running app; "partial" means the data model or
a slice exists but the requirement isn't satisfied; "missing" means no code.

**Headline: ~160 of ~333 counted requirements are met (≈48%).** The *core operational loop* — order →
kitchen → payment → FIFO stock deduction → COGS → reports → audit — is real, database-backed and verified
end-to-end (64–67 automated assertions green). The missing half is **breadth** (menu/recipe/settings
management, procurement depth, stock counts, multi-branch, offline PWA, integrations, real payments,
tests, manuals, deployment), plus one **stack conflict** that gates everything else.

---

## 0. The decision that gates everything: stack vs. hosting

| Your prompt requires | What exists | Verdict |
| --- | --- | --- |
| Backend **PHP / Laravel** | Next.js 16 server components + server actions (TypeScript) | ❌ different stack |
| Database **MySQL / MariaDB** | **PostgreSQL** (schema uses `numeric(12,3)`, `jsonb`, `date_trunc`, `make_interval`, `to_char`, `::numeric` casts) | ❌ not portable as-is |
| **Versioned RESTful API** | 2 routes only: `/api/health`, `/api/export`. All writes are Next server actions | ❌ no `/api/v1` |
| Deployable on **GreenGeeks** | The app's own `/spec` §2 states shared GreenGeeks plans have **no PostgreSQL** and only limited Node via Passenger; it recommends the **Managed VPS** tier | ⚠️ VPS yes, shared no |
| React + TypeScript + Tailwind | React 19 + TS + Tailwind v4 | ✅ |
| Charting library | Recharts | ✅ |
| No secrets in frontend | None found | ✅ |

So: the delivered app is a *credible* implementation of your **functional** spec on a **different stack**.
Under your §2 rules, GreenGeeks shared hosting cannot run it. Two honest paths:

* **Track A — keep this codebase**, deploy to GreenGeeks **Managed VPS** (or any Node host + managed
  Postgres). Everything built so far is kept; you close the functional gaps below.
* **Track B — rebuild as Laravel + MySQL** (your §2 preferred stack, and `/spec`'s "Option C") so it fits
  EcoSite shared hosting. The schema maps ~1:1 (22 tables, integer cents, FIFO layers) and every business
  rule is already written down and *tested* here, so it's a port, not a redesign — but it is a port.

Nothing else in this document changes based on that choice; the functional gaps are identical.

---

## 1. Scorecard

Counts are requirements met / counted from your prompt.

| § | Area | Met | Status |
| --- | --- | --- | --- |
| 2 | Stack & hosting | 4/11 | ⚠️ wrong stack, right shape |
| 3 | UI & design | 5/11 | ⚠️ good UI, missing top bar / search / themes / branding |
| 4 | Auth & RBAC | 7/13 | ⚠️ 5 of 6 roles, PIN-only, no reset/MFA |
| 5 | POS module | 19/28 | ✅ strongest area |
| 6 | Table management | 5/12 | ⚠️ read-only floor plan |
| 7 | Kitchen display | 7/11 | ✅ solid, no stations |
| 8 | Inventory & recipes | 17/30 | ⚠️ engine good, management thin |
| 9 | Procurement | 7/15 | ⚠️ create/receive only |
| 10 | Staff & shifts | 9/14 | ✅ core reconciliation works |
| 11 | Payments & printing | 8/18 | ⚠️ simulated gateways |
| 12 | Reporting | 11/23 | ⚠️ daily only, several reports absent |
| 13 | Owner dashboard | 7/12 | ✅ good, 5 tiles missing |
| 14 | Integrations | 1/11 | ❌ blueprint only |
| 15 | Offline PWA | 0/11 | ❌ not started |
| 16 | Database design | 5/11 | ⚠️ 22 of ~40 tables, no migrations |
| 17 | Security | 9/17 | ⚠️ real gaps (hashing, rate limit, dashboard) |
| 18 | GreenGeeks deployment | 7/15 | ⚠️ runbook only, no artefacts |
| 19 | Testing & QA | 3/10 | ⚠️ demo driver only, no test suite |
| 20 | 25 required pages | 15/25 | ⚠️ 12 routes, 10 pages absent |
| 21 | 6-phase process | 2.5/6 | ⚠️ phases 1–4 partial, 5–6 not started |
| 22 | Final deliverables | 2.5/6 | ⚠️ app + source; no deploy pkg / manuals / QA |
| 23 | Strict rules | 10/13 | ✅ mostly honoured — see §5 below |
| **Total** | | **≈160/333 (48%)** | |

---

## 2. What is genuinely built and verified

Evidence from the live run (`npm run demo`, 64–67 assertions, all green):

* **POS** — dine-in / takeaway / delivery, table selection, category navigation, modifiers with price
  deltas, combos that expand into child recipes, per-line kitchen notes, seats, order-level % and fixed
  discounts, tips, tax from `settings.tax_rate_bps` with tax-exempt items excluded and discounts pro-rated
  onto the taxable base, split bills (even 2–6 ways with remainder absorption, and per-seat proration),
  **mixed split tender** (cash partial → card balance), change on over-tender, voids (line + ticket),
  refunds with restock, unique order numbers (`E-1072`), employee + timestamp + type + status recorded.
* **Prices are computed server-side only** — `sendToKitchen` re-reads the menu and modifier options and
  ignores client-supplied numbers (§23 "no fake transactions" ✅).
* **KDS** — three-stage board (new → on the fire → ready), per-line and per-ticket bump, aging timers,
  modifiers and special instructions highlighted, 5 s polling (hosting-compatible, no WebSockets).
* **Inventory engine** — real FIFO cost layers, per-ingredient stock movements on every sale, shortfall
  handling, weighted-average repricing on purchase receipt, waste and count adjustments, low-stock
  alerting, valuation, recipe costing, food-cost %, margin analysis. Verified to the cent: an $111.51
  ticket consumed 8 ingredients across 8 movements and stamped **COGS $18.42**.
* **Procurement (core)** — suppliers, PO create → send → receive → cancel; stock and average cost update
  **only on receipt** (§9's key rule ✅).
* **Shifts** — drawer float, cash-taken aggregation, expected vs counted, variance, notes, clock in/out,
  timesheets, all audited.
* **RBAC + audit** — permission matrix enforced inside every server action (cook denied voids, inventory
  changes and exports — verified), and an immutable audit trail of every mutation.
* **Reports/exports** — daily sales with margin, payment mix, channel mix, top items, food cost, plus four
  CSV exports (sales / items / foodcost / inventory) behind the `export` permission.
* **Receipt** — 80 mm thermal print stylesheet, browser print, auto-print via `?print=1`, reprint link.

---

## 3. Gap list by section (what's missing or partial)

### §3 UI & design
❌ **No product search** in the POS (only category tiles). ❌ **No top navigation bar** — no branch name,
no notifications, no user menu (identity lives in the sidebar footer). ❌ **Light mode** — dark theme only,
no toggle. ❌ **No branding settings UI**: `settings` (restaurant name, tagline, address, currency, tax
rate) is written **only by the seeder** — there is no screen to change it, so receipts/tax can't be
configured. ⚠️ Tablet-optimised but not verified on touch hardware. ✅ Sidebar modules, modals, filters,
confirm-with-reason dialogs, loading/pending states, seed data that is fully DB-connected.

### §4 Authentication & RBAC
❌ **6th role missing**: no *Inventory Officer*; owner/super-admin and manager are not distinguished beyond
the `team` permission. ❌ **No password login, no password reset** — PIN only (4–6 digits).
❌ **No MFA**. ❌ **Weak hashing**: `sha256(pin + "|ember-pos")`, a static app-wide suffix over a 10,000-key
space (`/spec` calls it "salted" — it isn't). ❌ **No rate limiting** on login. ❌ **No scoping** of managers
to areas/branches. ⚠️ **`src/app/page.tsx` (dashboard) has no permission guard** and `proxy.ts` only checks
that a cookie *exists* → any cookie value renders real revenue (reproduced with
`curl -H 'Cookie: ember_session=x' /` → 200). ✅ Admin-managed accounts, activation/deactivation,
role-based nav, backend enforcement in actions, 12 h session expiry, httpOnly cookies, activity logs.

### §5 POS module
❌ **Product images** — no image column on `menu_items`, no uploads, no `public/` directory at all.
❌ **Item-level discounts** (order-level only). ❌ **Service charges**. ❌ **Multiple tax rules** (one global
rate + a per-item tax-exempt flag). ❌ **Order statuses**: your 8-state lifecycle (Draft → Confirmed →
Preparing → Ready → Served/Dispatched → Completed → Cancelled → Refunded) is implemented as 4 order states
(`open/completed/voided/refunded`) + 5 *line* states (`fired/preparing/ready/served/voided`) — workable but
not your model, and there is no Draft or dispatched/delivery-leg state. ⚠️ **Reprint has no authorization
check** (anyone with the `orders` permission can reprint). ⚠️ **Double-deduction risk**: `payOrder` inserts
payments *outside* the transaction and flips the status in a separate statement with no `where status =
'open'` guard, so a retry or two simultaneous taps can consume stock twice — this contradicts `/spec` §5's
"one transaction" claim. Everything else in §5 is met.

### §6 Table management
❌ No create/edit of **dining areas** (the concept doesn't exist). ❌ No add/edit tables, numbers or capacity
— the floor plan is seeded and **read-only**. ❌ No **reserved** or **cleaning** statuses (only
available/occupied, derived from open orders). ❌ No **move customers between tables**. ❌ No **merge
tables**. ✅ Open orders against tables, split bills via the POS pay modal, automatic release on settlement,
visual status with elapsed time and on-floor value, 10 s polling.

### §7 Kitchen display
❌ **Kitchen stations not implemented** — `menu_items.station` (`kitchen|bar`) exists in the schema and seed
but is never read by the KDS, so **food and drinks are not separated**. ❌ No station/area filtering.
⚠️ **Concurrency**: bumps are status-guarded (`where status in (...)`) but there is no row locking, so two
cooks racing can produce out-of-order transitions. ✅ Auto-display of fired tickets, order + table numbers,
highlighted special instructions and modifiers, per-item and per-ticket state changes, aging timers,
three-stage filtering, near-real-time polling, cashier/waiter views refresh.

### §8 Inventory & ingredient management
❌ **No inventory categories**. ❌ **No photos**. ❌ **No SKUs**. ❌ **No purchase-unit vs usage-unit and no
conversions** (carton→pieces, kg→g, L→ml) — one `unit` string per ingredient, so you cannot buy in cartons
and issue in pieces. ❌ **No stock transfers** (between locations; there are no locations either).
❌ **No stock counts / physical-vs-system reconciliation** — only ad-hoc adjustments. ❌ **No recipe yields,
preparation loss, substitutions or versions**. ❌ **No idempotency keys**, so a retried request can deduct
twice. ❌ **No LIFO** and weighted-average is not a *selectable* costing method (it's used for repricing and
theoretical food cost alongside FIFO). ⚠️ **No recipe or ingredient management UI beyond name/unit/reorder
level/supplier** — recipes are seeded, not editable. ✅ Create/edit ingredients, opening stock, receipts,
wastage, complete movement ledger, min levels, low-stock alerts, valuation, recipe→ingredient linkage,
automatic deduction at payment, FIFO layers that preserve historical costs when prices change, recipe cost,
food-cost %, gross profit and margin analysis.

### §9 Procurement
❌ **No PO approval workflow** (draft → sent → received, no approver, no permission gate beyond `inventory`).
❌ **No goods-received notes** as documents (receipt is a status change). ❌ **No partial deliveries**.
❌ **No supplier invoices**. ❌ **No supplier payment status**. ❌ **No purchase returns**. ❌ **No printable
POs, no PDF, no CSV export of purchases**. ✅ Supplier profiles and contacts, PO creation with line costs,
status tracking, purchase price history via FIFO layers, purchase history list, and the rule that stock
moves only on formal receipt.

### §10 Staff & shifts
❌ **No cash payouts** (paid-out/paid-in mid-shift). ❌ **No manager approval for discrepancies**.
❌ **No shift performance reports** and **no employee sales reports**. ⚠️ **Employee profiles are minimal** —
name, role, PIN, active; no contact details, hourly rate or employment data, so timesheets can't be costed.
✅ Shift open/close, clock in/out, timesheet list, drawer opening balance, cash transaction aggregation,
expected vs counted, shortage/surplus variance, notes, auditable records.

### §11 Payments & printing
❌ **No real gateway**: `card` and `mobile` are simulated locally with a `SIM-…` reference — no Stripe, no
Authorize.Net, no SDKs, no hosted payment fields, **no webhooks**, no modular provider layer. (To its
credit, nothing pretends otherwise: `/spec` labels these "planned" and the reference is visibly fake.)
❌ **No kitchen ticket printing** (KDS is screen-only). ❌ **No PDF receipts**. ❌ **No print bridge** for
network/USB thermal printers. ❌ **No reprint authorization**. ⚠️ **No logo on receipts** (name + address
come from the un-editable `settings` table). ✅ Cash, split tender, browser printing, 80 mm thermal layout,
branded text receipt with tax/discount/tip breakdown, no card data stored anywhere.

### §12 Reporting
❌ **Weekly / monthly / annual** rollups (range picker is 7/14/30 days of daily rows). ❌ **Revenue by
category**. ❌ **Sales by employee**. ❌ **Slow-moving items**. ❌ **Wastage report** (data is in the ledger).
❌ **Purchase expenditure report**. ❌ **Cash reconciliation report**. ❌ **Refunds report** (visible per
order, not aggregated). ❌ **Printable reports**. ⚠️ One chart (daily revenue); payment/channel mix are
bar-ish lists. ✅ Daily sales, revenue by product, sales by payment method, taxes collected, discounts,
gross profit, food cost, inventory valuation, low-stock, top sellers, date-range filter, sortable tables,
CSV downloads — all from real DB aggregates.

### §13 Owner dashboard
❌ **Active dine-in tables** tile (data exists on `/tables`). ❌ **Cash vs digital** split. ❌ **Inventory
value**. ❌ **Employee activity**. ❌ **Recent refunds and voids**. ✅ Today's sales, orders, average ticket,
gross-margin estimate, open orders, pending kitchen tickets, low-stock alerts, 14-day revenue chart, top
sellers, recent orders — and remote access from any device (it's a web app).

### §14 Integrations — **essentially not started**
❌ Stripe/Authorize.Net, QuickBooks, Xero, delivery platforms, printer integration, mobile POS API,
webhook verification/retries/idempotency, integration logs, adapter setup UI, external API auth, API
documentation. ✅ Only the CSV export shape (`/api/export`) that `/spec` proposes as an accounting bridge.
`/spec` §9 is a well-written *blueprint* — your §14 explicitly forbids counting a blueprint as an
integration, and it isn't one.

### §15 Offline PWA — **not started (0/11)**
No `public/` directory → no web manifest, no service worker, no installability, no cached shell, no
IndexedDB draft orders, no offline queue, no reconnection detection, no sync, no client-generated
transaction UUIDs or idempotency keys, no conflict handling, no online/offline indicator. `/spec` §10
describes the intended design (Phase 3) and correctly flags which workflows can't be offline — but none of
it is code.

### §16 Database design
❌ **MySQL/MariaDB** (it's PostgreSQL, with Postgres-only SQL in ~15 raw queries). ❌ **~40 required tables
→ 22 exist**. Absent: `restaurants`, `branches`, `roles`, `permissions` (both hard-coded in
`src/lib/perms.ts`), `employees`, `dining_areas`, `menu_item_images`, `units`, `unit_conversions`,
`inventory_locations`, `inventory_lots`, `stock_counts`, `goods_receipts`, `kitchen_tickets` (derived from
`order_items`), `refunds` / `discounts` / `taxes` (folded into `orders` columns), `cash_drawers`,
`cash_reconciliations` (folded into `shifts`), `integration_logs`, `sync_operations`, `order_modifiers`
(JSONB column instead). ❌ **No migrations** — schema is applied with `drizzle-kit push`; there is no
versioned history to roll back. ❌ **No row locking** for concurrency-sensitive paths. ⚠️ **No enums or
CHECK constraints**: `orders.status`, `payments.method`, `users.role` are free `text` with the allowed
values in comments. ✅ PKs/FKs, targeted indexes on hot paths, timestamptz, exact money (integer cents) and
quantity (`numeric(12,3)`) types, transactions on the critical paths, and a seeder.

### §17 Security
❌ **No HTTPS enforcement** in app code (left to the host). ❌ **No secure password hashing** (see §4).
❌ **No rate limiting**. ❌ **No encryption at rest / column-level crypto**. ❌ **No backup protection**
(documented in `/spec` only). ⚠️ **No request validation library** — actions hand-check a few fields.
⚠️ **Dashboard authorization hole** (§4). ⚠️ **`SESSION_SECRET` falls back to a hard-coded dev string**
instead of failing. ⚠️ Error logging is `console.*` only, no redaction policy. ✅ Parameterised queries
(no SQL injection found), React escaping (XSS), Next's origin check on server actions (CSRF-equivalent),
permission checks inside actions, env-based secrets, audit logs, httpOnly/SameSite cookie config,
refund/void restricted by role, and `/spec` is careful **not** to claim PCI certification.

### §18 GreenGeeks deployment
❌ **No deployment artefacts**: no PM2/ecosystem file, no Nginx/Passenger vhost, no `.htaccess`, no
document-root layout, no file-permission guidance, no cron entries, no cache config, no CI. ❌ **No verified
production build** (`npm run build` has not been run in this environment). ⚠️ Shared hosting is a hard
blocker for this stack (no Postgres) — `/spec` identifies it correctly and recommends the VPS tier, which
satisfies your "identify the blocker" rule but not "deploy it". ✅ Production source, `.env.example`,
dependency + run instructions (`RUNNING-LOCALLY.md`), SSL/domain guidance, backup and rollback procedures,
monitoring guidance — all as documents inside `/spec`.

### §19 Testing & QA
❌ **No automated test suite**: no test runner, no `test` script, no unit/integration/E2E files, no load
tests. ❌ Of your 21 required coverage areas, none has a committed test. ⚠️ What exists is
`scripts/demo.mjs` — a real, executed integration driver (64–67 assertions over HTTP + SQL covering auth,
role permissions, order creation, table assignment, kitchen tickets, status transitions, discounts/taxes,
split bills, cash payments, refunds/cancellations, ingredient deductions, recipe costing, PO receiving,
shift closing, report generation, unauthorised access). It satisfies the spirit of ~12 of your 21 areas but
is not a test suite (no runner, no unit coverage, no offline sync, no concurrency, no webhook, no load).
✅ UAT acceptance criteria exist as a document (`/spec` §16) and your rule "don't claim a test passed unless
executed" has been honoured — everything claimed here was actually run.

### §20 Required pages (12 routes exist; 25 required)

| Required page | Status | Where |
| --- | --- | --- |
| 1 Login | ✅ | `/login` |
| 2 Owner dashboard | ✅ | `/` |
| 3 POS terminal | ✅ | `/pos` |
| 4 Table management | ⚠️ read-only | `/tables` |
| 5 Kitchen display | ✅ | `/kitchen` |
| 6 Orders & transactions | ✅ | `/orders` |
| 7 **Menu management** | ❌ | menu is seed-only — no CRUD anywhere |
| 8 **Recipe management** | ❌ | recipes are seed-only |
| 9 Ingredient inventory | ✅ | `/inventory` → *Stock* tab |
| 10 Stock movement history | ✅ | `/inventory` → *Ledger* tab |
| 11 Purchase orders | ⚠️ | `/inventory` → *PO* tab (no approval/GRN/print) |
| 12 Suppliers | ✅ | `/inventory` → *Suppliers* tab |
| 13 **Goods receiving** | ❌ | a status change inside the PO tab |
| 14 **Stock counts** | ❌ | |
| 15 Staff management | ✅ | `/admin/users` → *Staff* tab |
| 16 Shift management | ✅ | `/shifts` |
| 17 Cash reconciliation | ✅ | `/shifts` (drawer panel) |
| 18 **Payment history** | ⚠️ | per-order only, no dedicated ledger page |
| 19 **Refund management** | ⚠️ | actions + filters on `/orders`, no dedicated page |
| 20 Reports & analytics | ✅ | `/reports` |
| 21 Audit logs | ✅ | `/admin/users` → *Audit* tab |
| 22 **Integrations** | ❌ | |
| 23 **Restaurant settings** | ❌ | `settings` table is seeder-only |
| 24 **Branch management** | ❌ | no multi-branch model at all |
| 25 **User roles & permissions** | ❌ | matrix hard-coded in `src/lib/perms.ts`, no UI |

### §21–22 Process & deliverables
Phases 1–4 are partially complete (foundation ✅, POS ✅ minus menu management, inventory ✅ minus
counts/transfers/units, operations ✅ minus employee/shift reporting). **Phase 5 (gateways, thermal print
bridge, accounting adapters, offline PWA, API docs) and Phase 6 (hardening, testing, UAT, deployment,
backup verification, staff training) are not started.** Deliverables: application ✅, source ✅ (minus
migrations and API docs), deployment package ❌, documentation ❌ (no administrator/cashier/kitchen/
inventory-officer/troubleshooting/security manuals — `ANALYSIS.md`, `RUNNING-LOCALLY.md` and the in-app
`/spec` cover engineering ground only), QA ❌ (demo driver only), commercial planning ✅ (`/spec` §12–15:
roadmap, effort by phase, cost estimate, recurring hosting/third-party costs, maintenance, SLA options).

---

## 4. Non-negotiable fixes before this touches real money

1. **Dashboard authorization** — add `getSession()` + `can(role,"dashboard")` to `src/app/page.tsx`, and
   make `proxy.ts` verify the cookie signature rather than its presence. Currently any cookie value
   (`ember_session=x`) returns live revenue data.
2. **Make payment atomic and idempotent** — one transaction: lock the order (`select … for update`) →
   insert payments → conditional status flip (`where status='open'`, assert `rowCount=1`) → FIFO deduction →
   COGS stamp; plus a client-supplied idempotency key with a unique index. Without this, a double tap or a
   retry double-deducts inventory and can double-charge.
3. **Replace PIN hashing** with Argon2id/scrypt + per-user salt, and add login rate limiting.
4. **Remove the `SESSION_SECRET` fallback** — fail fast if it's unset in production.
5. **Introduce versioned migrations** (`drizzle-kit generate` + a migrate step) instead of `push`.
6. **Refund costing** — restock against the layers the sale consumed, not the current average, and reverse
   `cogs_cents`.

## 5. Your §23 "strict rules" — compliance check

| Rule | Verdict |
| --- | --- |
| No mockups instead of an app | ✅ it runs |
| No static arrays as the final data store | ✅ everything is Postgres-backed |
| No non-functional buttons | ✅ every control in the 12 routes does something (verified by the demo driver) |
| No fabricated payments | ✅ card/mobile are labelled `SIM-…`; nothing claims a gateway response |
| No fake inventory transactions | ✅ real FIFO layers and movements |
| No omitted backend authorization | ⚠️ enforced in all 23 actions; **the dashboard page is the exception** |
| No hard-coded credentials | ⚠️ fixed here (`drizzle.config.ts` now reads `.env`), but `SESSION_SECRET` still has a dev fallback |
| No exposed secret keys | ✅ |
| No sacrificing transaction integrity for UI convenience | ⚠️ `payOrder` boundary — see §4.2 |
| No production-readiness claims before testing | ✅ no such claim is made |
| No deployment claims without access | ✅ `/spec` presents a runbook, never claims it was executed |
| No integration claims without credentials | ✅ all marked "planned" |

---

## 6. Suggested gap-closure order (Track A estimates)

| Priority | Work | Effort |
| --- | --- | --- |
| P0 | §4 security fixes (dashboard guard, atomic+idempotent payment, Argon2id, rate limit, secret fail-fast) | 2–3 days |
| P1 | **Menu management + Recipe management + Restaurant settings** pages (unblocks everything downstream; today the menu can only be changed by editing the seeder) | 4–6 days |
| P1 | Inventory depth: units + conversions, SKUs, categories, stock counts/reconciliation, transfers | 5–7 days |
| P2 | Procurement depth: approval, GRN, partial delivery, supplier invoices/payments, returns, printable PO + CSV/PDF | 4–6 days |
| P2 | Tables: areas CRUD, table CRUD, reserved/cleaning, move/merge | 3–4 days |
| P2 | KDS stations (use the existing `station` column) + concurrency locking | 2 days |
| P2 | Reports: weekly/monthly/annual, by category, by employee, wastage, purchases, refunds, cash recon, printable | 3–4 days |
| P3 | Payments: real Stripe (or AuthNet) adapter + webhooks + idempotency; print bridge; PDF receipts | 6–10 days |
| P3 | Multi-branch: `restaurants`/`branches` + scope every query | 5–8 days (touch-everything) |
| P3 | Test suite (Vitest + Playwright) covering your 21 areas, CI | 5–8 days |
| P4 | Offline PWA (manifest, SW, IndexedDB drafts, sync queue, idempotency) | 8–12 days |
| P4 | Integrations: QuickBooks/Xero adapters, delivery platforms, integration logs + setup UI | 8–12 days |
| P4 | Deployment package + the five user manuals + UAT pack | 4–6 days |

Rough total to satisfy the prompt end-to-end on this codebase: **~8–11 focused weeks**. Track B (Laravel +
MySQL port) would re-spend the P0–P3 build effort against a schema and rule set that are already proven
here — call it a similar order of magnitude, with the benefit of fitting GreenGeeks shared hosting.
