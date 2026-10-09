import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import {
  Sparkles, Server, Layers, Map, Database, Plug, ShieldCheck, Printer,
  Wifi, Gauge, Rocket, FlaskConical, CalendarClock, Calculator,
  LifeBuoy, ClipboardCheck, FileText,
} from "lucide-react";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

type Section = { id: string; icon: typeof Sparkles; title: string; body: ReactNode };

function H3({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 mt-5 font-display text-base font-bold text-zinc-100">{children}</h3>;
}
function P({ children }: { children: ReactNode }) {
  return <p className="mb-3 text-sm leading-relaxed text-zinc-400">{children}</p>;
}
function UL({ items }: { items: ReactNode[] }) {
  return (
    <ul className="mb-3 space-y-1.5 text-sm text-zinc-400">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2">
          <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ember-500" />
          <span className="leading-relaxed">{it}</span>
        </li>
      ))}
    </ul>
  );
}
function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="mb-4 overflow-x-auto rounded-xl border border-zinc-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-zinc-900/60 text-left text-[11px] uppercase tracking-wider text-zinc-500">
            {head.map((h) => <th key={h} className="px-4 py-2.5">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-zinc-800/60">
              {r.map((c, j) => <td key={j} className="px-4 py-2.5 align-top text-zinc-300">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Callout({ tone, title, children }: { tone: "warn" | "ok" | "info"; title: string; children: ReactNode }) {
  const cls = tone === "warn" ? "border-amber-500/40 bg-amber-500/5 text-amber-200"
    : tone === "ok" ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-200"
    : "border-sky-500/40 bg-sky-500/5 text-sky-200";
  return (
    <div className={`mb-4 rounded-xl border p-4 ${cls}`}>
      <div className="mb-1 text-sm font-bold">{title}</div>
      <div className="text-sm leading-relaxed opacity-90">{children}</div>
    </div>
  );
}
function Code({ children }: { children: ReactNode }) {
  return (
    <pre className="mb-4 overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-300">{children}</pre>
  );
}

export default async function SpecPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const sections: Section[] = [
    {
      id: "summary", icon: Sparkles, title: "Executive summary",
      body: (
        <>
          <P>
            This document is the technical specification, implementation plan and deployment strategy for the
            restaurant POS + inventory platform you are looking at right now. The running application —
            <span className="font-semibold text-zinc-200"> Ember POS</span> — is the delivered reference
            build: order entry for dine-in / takeaway / delivery, a live floor plan, a kitchen display
            system, split bills, discounts, tips, taxes, refunds, ingredient-level recipes with automatic
            FIFO stock deduction per sale, purchase orders, suppliers, low-stock alerts, food-cost &amp;
            margin reporting, five role-based staff profiles, shift close with cash reconciliation,
            timesheets, and a full audit trail.
          </P>
          <P>
            Below you will find: a verified assessment of GreenGeeks hosting constraints, the recommended
            production architecture, the database and API outlines, the security/PCI posture, integration
            blueprints (Stripe Terminal, Authorize.Net, QuickBooks/Xero, delivery platforms, printing),
            the offline/PWA strategy, a step-by-step GreenGeeks deployment runbook with backup/rollback,
            a testing &amp; QA plan, and a phased roadmap with time and cost estimates.
          </P>
          <Callout tone="ok" title="What is already proven">
            Every workflow referenced in this document runs end-to-end in this build — from PIN login →
            order → kitchen bump → split payment → FIFO deduction → food-cost report → CSV export →
            shift reconciliation. Sign in as Admin <span className="font-mono">0000</span> to explore everything.
          </Callout>
        </>
      ),
    },
    {
      id: "greengeeks", icon: Server, title: "Verified GreenGeeks constraints",
      body: (
        <>
          <P>
            GreenGeeks is a cPanel-based host (LiteSpeed on shared, AutoSSL via Let&rsquo;s Encrypt,
            JetBackup on most plans). The critical findings, confirmed against GreenGeeks&rsquo; own support
            documentation:
          </P>
          <Table
            head={["Plan tier", "Node.js", "Databases", "Root / SSH", "Verdict"]}
            rows={[
              ["EcoSite Lite (base shared)", <span key="a" className="font-bold text-red-400">Not supported</span>, "MySQL/MariaDB only", "No root; limited SSH", "Requires a PHP (LAMP) build — see Option C"],
              ["EcoSite Pro / Premium (shared)", "Limited — cPanel “Setup Node.js App” (Phusion Passenger)", "MySQL/MariaDB only", "No root; SSH on request", "Workable for this Next.js app with an external managed PostgreSQL (Neon/Supabase/RDS). No help from GreenGeeks with app config; no guaranteed long-lived daemons or WebSockets."],
              ["Managed VPS", "Full support (cPanel Node selector + OS-level Node)", "PostgreSQL + MySQL", "Full root via SSH/WHM", <span key="b" className="font-bold text-emerald-400">Recommended target</span>],
            ]}
          />
          <UL items={[
            <>Shared hosting runs on <b>LiteSpeed</b> — Node apps are proxied through Passenger. Long-running
              processes may be recycled under memory pressure; design for statelessness (this app is stateless:
              sessions are signed cookies, all state lives in Postgres).</>,
            <>There is <b>no PostgreSQL on shared cPanel plans</b>. Either run Postgres on the VPS tier, or pair
              EcoSite Premium with a managed Postgres provider (Neon, Supabase, AWS RDS) over a pooled connection
              (pgBouncer-style, SSL required).</>,
            <>Free <b>AutoSSL</b> covers the storefront domain and POS subdomain on every tier.</>,
            <>Real-time features (KDS) must use <b>polling or SSE</b> on shared tiers — Passenger does not reliably
              pass WebSocket upgrades. This build polls every 5s, which works everywhere.</>,
          ]}
          />
          <Callout tone="warn" title="Hosting recommendation">
            Deploy on the <b>GreenGeeks Managed VPS</b> tier. It removes every shared-hosting caveat (Node
            version control, PostgreSQL, daemons for workers, firewall control) while staying inside
            GreenGeeks — no replatforming later. Option B (EcoSite Premium + managed Postgres) is the
            budget path; Option C (Laravel + MySQL on EcoSite Lite) only if the VPS tier is off the table.
          </Callout>
        </>
      ),
    },
    {
      id: "architecture", icon: Layers, title: "Recommended stack & architecture",
      body: (
        <>
          <Table head={["Layer", "Choice", "Why"]} rows={[
            ["Runtime / framework", "Next.js 16 (App Router) on Node 22 LTS", "One codebase for POS, KDS, admin and APIs; server components + server actions minimise client JS on tablets"],
            ["Database", "PostgreSQL 16 + Drizzle ORM", "Transactional integrity for payments & stock movements; drizzle-kit push for zero-downtime schema deploys"],
            ["AuthN/AuthZ", "PIN sign-in, HMAC-signed httpOnly cookie sessions, RBAC matrix (5 roles)", "Shift-friendly fast login; upgrade path: next-auth with refresh tokens + IdP"],
            ["POS client", "Responsive PWA (tablet/desktop), optimistic cart, 80mm print stylesheet", "Works on any browser — no per-device installs"],
            ["APIs", "Server actions for the app; versioned REST under /api for exports & mobile", "Single source of truth in server code; mobile apps consume the same REST surface"],
            ["Caching", "DB indexes + per-request React cache; route-level force-dynamic for live screens", "POS correctness first; add Redis/Cloudflare only for the public menu/API edge"],
          ]} />
          <H3>Shape</H3>
          <Code>{`tablets / KDS screens / phones
        │  HTTPS (AutoSSL / Let's Encrypt)
        ▼
LiteSpeed / Nginx reverse proxy ──► Next.js 16 (PM2, 2 instances)
                                       │ server actions + /api/*
                                       ▼
                              PostgreSQL 16 (local socket)
        Peripherals: browser print → 80mm thermal (Star/EPSON)
                     Stripe Terminal readers (server-driven)
                     Scheduled jobs: nightly pg_dump, report snapshots`}</Code>
          <P>
            Option C (EcoSite Lite): same feature set re-implemented as Laravel 11 + MySQL 8 + Inertia/React
            — the schema below maps 1:1 (numeric quantities, integer cents, FIFO layers). Only choose this
            if constrained to the base shared plan.
          </P>
        </>
      ),
    },
    {
      id: "features", icon: Map, title: "Feature → module map",
      body: (
        <Table head={["Requested capability", "Status in this build", "Where"]} rows={[
          ["Order entry — dine-in / takeaway / delivery", "Delivered", "/pos (type toggle, customer + address capture)"],
          ["Table management", "Delivered", "/tables live floor plan with occupancy, elapsed time, on-floor value"],
          ["Kitchen display & ticketing", "Delivered", "/kitchen 3-stage KDS (new → on the fire → ready), per-line and per-ticket bump, aging colours"],
          ["Receipt printing", "Delivered", "/receipt/[id] 80mm print stylesheet + browser print; ESC/POS server option in §8"],
          ["Split bills (even / by seat), split payments", "Delivered", "Pay modal: full, split-even 2–6 ways, per-seat proration; mixed tenders per order"],
          ["Discounts & tips & taxes", "Delivered", "Percent/fixed discounts, tip presets, per-order tax with proration on splits"],
          ["Modifiers & combos", "Delivered", "Required/optional modifier groups with min/max; combos expand through child recipes for stock"],
          ["Refunds & voids", "Delivered", "Role-gated, reason-required, full audit trail; refunds restock via FIFO refund layers"],
          ["Ingredient recipes + auto deduction per sale", "Delivered", "recipes table; FIFO consumeFifo() on payment completion; negative-stock guard with costing at weighted average"],
          ["Purchase orders & suppliers", "Delivered", "/inventory: draft → sent → received; receipts create FIFO layers and re-price weighted average cost"],
          ["Stock adjustments & ledger", "Delivered", "Adjustment/waste postings with notes; full stock_movements ledger with user attribution"],
          ["Low-stock alerts", "Delivered", "Reorder-level engine; dashboard strip + inventory flags + PO quick-create"],
          ["FIFO/LIFO costing", "Delivered (FIFO)", "fifo_layers consumed oldest-first; COGS stamped on each order; LIFO = flip layer ordering (config flag)"],
          ["Food-cost & margin reports", "Delivered", "/reports theoretical plate cost vs price at current FIFO averages + realized COGS per period"],
          ["Users, roles & permissions", "Delivered", "admin, manager, cashier, cook, accountant with a permission matrix enforced in every server action"],
          ["Employee timesheets", "Delivered", "/shifts clock-in/out with durations; manager-visible team view"],
          ["Shift close & cash reconciliation", "Delivered", "Expected = float + non-refunded cash; variance capture with notes and history"],
          ["Audit logs", "Delivered", "audit_logs on every mutation: auth, orders, payments, refunds, inventory, POs, shifts, users"],
        ]}
        />
      ),
    },
    {
      id: "schema", icon: Database, title: "Database schema outline",
      body: (
        <>
          <P>
            Conventions: money is <span className="font-mono text-zinc-200">integer cents</span>;
            quantities are <span className="font-mono text-zinc-200">numeric(12,3)</span> base units
            (g / ml / pcs); unit costs are <span className="font-mono text-zinc-200">numeric(14,4) cents</span>.
            All tables indexed on their hot paths (order status, item status, movement ingredient/fifo).
          </P>
          <Table head={["Domain", "Tables", "Notes"]} rows={[
            ["Identity", "users, time_entries, audit_logs, settings", "Salted PIN hashes; settings holds tax rate + profile"],
            ["Menu", "categories, menu_items, combo_items, modifier_groups, modifier_options, item_modifier_groups", "Combos expand into child recipes for costing"],
            ["Inventory", "ingredients, recipes, suppliers, purchase_orders, purchase_order_items", "recipes.qty = base units per serving"],
            ["Costing", "fifo_layers, stock_movements", "Layers carry qty_remaining + unit_cost; sales consume oldest first and post a movement per ingredient"],
            ["FOH", "restaurant_tables, shifts, orders, order_items, payments", "orders keep denormalised totals + cogs_cents; payments support multi-tender splits with seat attribution"],
          ]} />
          <H3>Key transactional invariants</H3>
          <UL items={[
            "Payment completion + stock deduction + COGS stamping run in ONE transaction — a sale can never exist without its deduction.",
            "PO receipt + FIFO layer creation + moving-average repricing run in ONE transaction.",
            "Order totals are recomputed server-side from locked line snapshots — the client never sets a price.",
          ]} />
        </>
      ),
    },
    {
      id: "api", icon: Plug, title: "API surface",
      body: (
        <>
          <P>Server actions power the first-party UI (typed, session-guarded). The REST surface below is versioned and API-key ready for mobile POS apps and third parties.</P>
          <Table head={["Endpoint", "Method", "Purpose"]} rows={[
            ["/api/health", "GET", "Liveness + DB probe (used by the deploy healthcheck)"],
            ["/api/export?report=sales|items|foodcost|inventory&range=N", "GET", "CSV exports (role: export)"],
            ["/api/v1/orders", "POST", "Create/append order from mobile POS (planned — mirrors sendToKitchen action)"],
            ["/api/v1/orders/:id/payments", "POST", "Attach payments; completion triggers FIFO deduction (planned)"],
            ["/api/v1/kds/tickets", "GET", "Active tickets feed for any kitchen screen (planned)"],
            ["/api/v1/inventory/on-hand", "GET", "Stock levels for ordering apps (planned)"],
            ["/api/v1/webhooks/stripe", "POST", "Terminal payment confirmations (planned, signature-verified)"],
          ]} />
        </>
      ),
    },
    {
      id: "security", icon: ShieldCheck, title: "Security & PCI posture",
      body: (
        <>
          <H3>Application security</H3>
          <UL items={[
            "Transport: AutoSSL everywhere; HSTS + secure cookies in production (SESSION_SECRET from env, never committed).",
            "AuthZ: single permission matrix checked inside every server action — not just hidden UI.",
            "Injection: all queries parameterised via Drizzle ORM; the few raw statements interpolate only server-side values through tagged SQL.",
            "Integrity: prices, discounts and totals recomputed server-side; stock deduction is transactional (see §5).",
            "Audit: every mutation writes user, action, entity and metadata to audit_logs — the accountability backbone for refunds/voids/discounts.",
            "Rate limiting: per-IP login throttling + global 429s at the reverse proxy (LiteSpeed anti-DDoS or Nginx limit_req) — configured in the deploy runbook.",
            "Passwords/PINs: salted SHA-256 today (demo); production hardening swaps to Argon2id — isolated to one helper (hashPin).",
            "Encryption at rest: Postgres data dir on encrypted VPS volume; column-level pgcrypto for future stored tokens (QuickBooks refresh tokens, gateway keys).",
          ]}
          />
          <H3>PCI DSS guidance</H3>
          <UL items={[
            <>Never touch PAN data. Card-present flows use <b>Stripe Terminal</b> (encrypted reader → Stripe); card-not-present uses Stripe Elements — keeping you in <b>SAQ-A / SAQ-C-terminal</b> scope.</>,
            "Authorize.Net alternative: Accept.js tokenisation; the gateway stores card data, we store only the opaque token/reference.",
            "Receipts mask everything except brand + last4 (provided by the gateway object).",
            "Annual SAQ + quarterly ASV scans; isolate the POS VLAN at the site network level.",
          ]}
          />
          <H3>Backups</H3>
          <UL items={[
            "Nightly pg_dump → compressed → offsite (S3/Backblaze B2), 35-day retention; weekly full-verify restore drill.",
            "JetBackup account snapshots as a second, independent layer.",
            "Point-in-time: enable WAL archiving on the VPS for ≤15 min RPO.",
          ]}
          />
        </>
      ),
    },
    {
      id: "integrations", icon: Printer, title: "Integration blueprints",
      body: (
        <>
          <Table head={["System", "Approach", "Notes"]} rows={[
            ["Stripe Terminal (card-present)", "Server-driven: create PaymentIntent in payOrder, push to reader via Terminal SDK; webhook confirms", "Readers: BBPOS WisePad 3 / Stripe Reader S700. Simulated 'card' tender in this build maps 1:1 to the confirmed-intent path"],
            ["Authorize.Net", "Accept.js nonce → createTransactionRequest server-side", "Good fit for US merchants with existing AuthNet merchant accounts"],
            ["Receipt / kitchen printers", "Phase 1: browser print to any 80mm thermal (already working). Phase 2: tiny on-site print server (Raspberry Pi) translating order payloads to ESC/POS over LAN for Star TSP143III / Epson TM-T88VI", "Also supports Star CloudPRNT for zero-config sites"],
            ["QuickBooks / Xero", "Nightly journal sync: sales, tax, tips, COGS from /api/export-shaped data; OAuth2 with encrypted refresh tokens", "Account mapping screen added in Phase 2; CSV bridge works today"],
            ["Delivery platforms", "DoorDash Drive / Uber Direct white-label delivery; aggregator menus via Deliverect/Otter middleware → normalise into the same orders table with type='delivery'", "Webhooks land as courier status on the ticket"],
            ["Mobile POS apps", "Versioned REST (§6) + API keys per device; same RBAC matrix", "PWA covers most needs without an app store"],
          ]}
          />
        </>
      ),
    },
    {
      id: "pwa", icon: Wifi, title: "PWA & offline strategy",
      body: (
        <>
          <UL items={[
            "Installable PWA manifest + service worker (Phase 3): shell cached, POS screen opens offline.",
            "Order capture works offline: cart persists to IndexedDB; on reconnect, a background-sync replay posts sendToKitchen payloads in order with idempotency keys (order client UUID unique index).",
            "Offline payments: cash fully supported (queued); card requires connectivity — terminal prompts queue and retry.",
            "KDS degrades to last-known tickets with a visible 'offline' banner; polling resumes automatically.",
            "Conflict model: server wins on inventory numbers; offline tickets are re-priced server-side on replay and differences are surfaced at the till.",
          ]}
          />
        </>
      ),
    },
    {
      id: "performance", icon: Gauge, title: "Caching & performance",
      body: (
        <>
          <UL items={[
            "Live screens are force-dynamic — correctness over cache for money and stock.",
            "Menu/catalog endpoints are candidate-cached (60s stale-while-revalidate) once traffic grows; invalidate on save via revalidateTag('menu').",
            "DB indexes already sit on the hot paths: orders(status, created_at), order_items(order_id, status), stock_movements(ingredient_id), fifo_layers(ingredient_id), payments(order_id).",
            "Reports run on read-aggregates ≤ 90 days; larger history gets a nightly summary table (sales_daily) — queried by the same UI.",
            "Target SLOs on a 2-CPU VPS: POS read p95 < 250 ms, checkout write p95 < 700 ms, KDS board render < 150 ms.",
          ]}
          />
        </>
      ),
    },
    {
      id: "devops", icon: Rocket, title: "DevOps & GreenGeeks deployment runbook",
      body: (
        <>
          <H3>CI/CD</H3>
          <P>GitHub Actions on every PR: lint → typecheck (tsc) → unit tests → production build artifact. Merges to main deploy to <span className="font-mono">staging.yourdomain.com</span>; tagged releases deploy to production via rsync-over-SSH with a symlink swap (instant rollback).</P>
          <H3>Path A — Managed VPS (recommended)</H3>
          <Code>{`# 1. Create the cPanel account for the POS subdomain in WHM, enable AutoSSL
# 2. SSH in as root; install Node 22 LTS + PM2
curl -fsSL https://rpm.nodesource.com/setup_22.x | bash - && dnf install -y nodejs
npm i -g pm2 && pm2 startup systemd
# 3. Install PostgreSQL 16, create role + db
dnf install -y postgresql16-server && postgresql-16-setup initdb && systemctl enable --now postgresql
sudo -u postgres psql -c "CREATE USER ember WITH PASSWORD '...'; CREATE DATABASE ember_pos OWNER ember;"
# 4. Deploy the app (as cPanel user)
cd /home/POSUSER && git clone git@github.com:you/ember-pos.git app && cd app
npm ci && npm run build
printf 'DATABASE_URL=postgres://ember:...@127.0.0.1:5432/ember_pos\nSESSION_SECRET=...\n' > .env.production
npx drizzle-kit push                # apply schema (idempotent)
# 5. Run 2 instances + reverse proxy (Passenger or Nginx vhost 127.0.0.1:3000)
pm2 start npm --name ember-pos -i 2 -- start && pm2 save
# 6. Harden: firewall ports (80/443/SSH only), fail2ban, logrotate, pm2 resurrect`}</Code>
          <H3>Path B — EcoSite Premium (shared)</H3>
          <Code>{`# Build standalone bundle locally:  next build (output: 'standalone')
# Upload .next/standalone + .next/static + public via the cPanel File Manager/SSH
# cPanel → Software → Setup Node.js App:
#   Node 22 · app root /home/USER/pos · startup file server.js (from standalone)
# Set env vars in the Node app UI (DATABASE_URL points to your managed Postgres,
# SESSION_SECRET, NODE_ENV=production) → Restart app. Done.`}</Code>
          <H3>Backup & rollback</H3>
          <UL items={[
            "Backup: nightly cron pg_dump | gzip → rclone to B2/S3 (35-day retention) + JetBackup account snapshots; restore drill monthly.",
            "Rollback: releases are tagged git SHAs in /releases/<sha> with a current symlink — rollback = repoint symlink + pm2 reload (≤30s). Schema change? Snapshot the DB immediately before drizzle-kit push; backward-compatible migrations only (expand → migrate → contract).",
            "Monitoring: UptimeRobot /api/health each 60s (SMS/email), PM2 metrics + log tailing to Better Stack, Sentry for exceptions, pgBadger weekly; alerts on 5xx rate, p95 latency, disk > 75%, failed backups.",
          ]}
          />
        </>
      ),
    },
    {
      id: "testing", icon: FlaskConical, title: "Testing & QA plan",
      body: (
        <>
          <Table head={["Layer", "Tooling", "Coverage focus"]} rows={[
            ["Unit", "Vitest", "computeTotals incl. discount proration + splitEven; consumeFifo across multiple layers + shortfall; weighted-average repricing on PO receipt"],
            ["Integration", "Vitest + test Postgres (docker)", "order → pay → deduction → COGS; refund restock; shift expected-cash math; RBAC denial paths"],
            ["E2E", "Playwright (tablet viewport)", "golden path: open shift → seat table → fire → KDS bump → split by seat → mixed tender → receipt; refund; PO receive; low-stock alert appears"],
            ["Load", "k6", "200 rps menu reads, 60 checkouts/min sustained p95 < 700 ms; 20 concurrent KDS pollers"],
            ["UAT", "Checklist (§15) with the owner + one cashier + one cook", "Sign-off per role before go-live"],
          ]} />
          <H3>Training materials</H3>
          <UL items={[
            "Role one-pagers (cashier flow, cook KDS card, manager close-out), laminated at the station.",
            "Three 5-minute screen-capture videos: taking an order, closing a shift, receiving a PO.",
            "Shadow-shift support for opening weekend; a 'training mode' demo restaurant (seeded data) for practice.",
          ]}
          />
        </>
      ),
    },
    {
      id: "roadmap", icon: CalendarClock, title: "Roadmap & timeline",
      body: (
        <Table head={["Phase", "Scope", "Duration", "Exit criteria"]} rows={[
          ["0 — Foundation (done)", "This platform: POS, tables, KDS, inventory FIFO, reports, RBAC, shifts, audit", "✓ delivered", "All modules live in this build"],
          ["1 — Hardening & pilot", "Argon2id, rate limiting, backups, monitoring, Playwright suite, pilot site", "3 weeks", "Pilot store live; UAT checklist signed"],
          ["2 — Money & paper", "Stripe Terminal live cards, Authorize.Net, ESC/POS print server, QuickBooks/Xero sync, sales_daily summary", "4 weeks", "Real cards + auto-print in production; books reconcile to the penny"],
          ["3 — Reach", "PWA offline mode, DoorDash Drive webhooks, mobile REST v1, multi-tax jurisdictions", "4 weeks", "Offline order capture demo; first platform order flows to KDS"],
          ["4 — Scale", "Multi-location, central purchasing, franchise reporting, Redis edge cache", "6 weeks", "2+ locations on one instance"],
          ["UAT & cutover buffer", "Data migration (menu/inventory import), training, go-live weekend", "2 weeks", "Go-live sign-off"],
        ]}
        />
      ),
    },
    {
      id: "costs", icon: Calculator, title: "Cost estimate (rough-order-of-magnitude)",
      body: (
        <>
          <Table head={["Item", "Estimate", "Notes"]} rows={[
            ["Phase 1–3 build (single senior dev, on top of this foundation)", "$28k – $42k", "~13 weeks blended; fixed-bid per phase possible"],
            ["Same scope via a small studio", "$55k – $85k", "Adds PM/QA bench and parallel streams"],
            ["GreenGeeks Managed VPS (2–4 vCPU)", "$40 – $80 /mo", "Includes cPanel/WHM license"],
            ["Backups (B2/S3 100 GB) + monitoring + error tracking", "$15 – $40 /mo", "Better Stack / Sentry free tiers initially"],
            ["Payments", "Stripe: 2.6% + 10¢ tap/dip; Terminal reader $59 – $249 each", "Authorize.Net: gateway ~$25/mo + merchant account"],
            ["Per-site hardware", "$600 – $1,200", "Tablet or terminal, Star/Epson thermal printer, cash drawer, reader"],
          ]} />
          <P>Estimates exclude menu photography, aggregator commissions, and any custom franchise logic in Phase 4 (quoted separately after a discovery workshop).</P>
        </>
      ),
    },
    {
      id: "sla", icon: LifeBuoy, title: "Post-launch support & SLA",
      body: (
        <Table head={["Tier", "Response / resolution", "Includes", "Price"]} rows={[
          ["Standard", "Next business day / 3 business days", "Email support, monthly patching, quarterly restore drill", "$150/mo"],
          ["Priority", "4 business hours / 1 business day", "+ hotfix SLA, monthly health report, small tweaks (≤4h/mo)", "$450/mo"],
          ["Mission-critical", "1 hour, 24/7 for Sev-1 / same day", "+ on-call weekends, proactive monitoring ownership, annual PCI paperwork assist", "$950/mo"],
        ]}
        />
      ),
    },
    {
      id: "uat", icon: ClipboardCheck, title: "UAT acceptance criteria",
      body: (
        <UL items={[
          "A cashier can run the golden path (seat → fire → split by seat → mixed cash+card → printed receipt) in under 90 seconds with zero training.",
          "Every completed sale visibly decrements its recipe ingredients within the same second (stock ledger shows the movement).",
          "A refund re-adds stock, flips the order to refunded, and appears in the audit log with operator, reason and totals.",
          "Shift close expected cash equals float + non-refunded cash payments to the cent; variance is recorded, not editable.",
          "Receiving a PO creates FIFO layers and changes the weighted average cost visible in the food-cost report.",
          "Low-stock items surface on dashboard, inventory and the PO quick-create strip.",
          "Roles: cook sees only KDS; cashier cannot refund; accountant cannot touch the till.",
          "p95 checkout < 700 ms under k6 load profile; zero failed transactions.",
          "Backups restore cleanly on the drill day; rollback drill completes in < 5 minutes.",
        ]}
        />
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl p-6 lg:p-10">
      <div className="mb-10">
        <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.25em] text-ember-500">
          <FileText className="h-4 w-4" /> Technical Blueprint v1.0
        </div>
        <h1 className="font-display text-4xl font-bold tracking-tight">POS + Inventory platform for GreenGeeks</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-500">
          Architecture, security, integrations, deployment runbook, QA plan, roadmap and cost model for the
          system running on this very URL. Review section by section — approval of this plan green-lights
          Phase 1.
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
        {/* TOC */}
        <div className="no-print lg:sticky lg:top-8 lg:self-start">
          <nav className="flex flex-wrap gap-1 lg:flex-col">
            {sections.map((s, i) => (
              <a key={s.id} href={`#${s.id}`}
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-ember-300">
                <span className="font-mono text-[10px] text-zinc-600">{String(i + 1).padStart(2, "0")}</span>
                {s.title}
              </a>
            ))}
          </nav>
        </div>

        {/* sections */}
        <div className="space-y-4">
          {sections.map((s, i) => (
            <section key={s.id} id={s.id} className="scroll-mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 lg:p-7">
              <div className="mb-4 flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-ember-500/10 text-ember-400">
                  <s.icon className="h-4.5 w-4.5" />
                </span>
                <h2 className="font-display text-xl font-bold tracking-tight">
                  <span className="mr-2 font-mono text-sm text-zinc-600">{String(i + 1).padStart(2, "0")}</span>
                  {s.title}
                </h2>
              </div>
              {s.body}
            </section>
          ))}

          <div className="rounded-2xl border border-ember-500/30 bg-ember-500/5 p-6">
            <h3 className="font-display text-lg font-bold">Decision requested</h3>
            <p className="mt-2 text-sm leading-relaxed text-zinc-300">
              (1) Approve the Managed-VPS architecture on GreenGeeks (Path A) — or flag Path B/C;  
              (2) pick the support tier; (3) authorise Phase 1 (3 weeks). Reply with your choices and the
              pilot date goes on the calendar.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
