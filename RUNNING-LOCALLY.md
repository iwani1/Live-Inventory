# Running Ember POS on your own computer

Every step below was executed end-to-end against a **fresh, empty database** to make sure the instructions
are real, not aspirational. Expected time: ~3 minutes (most of it `npm install`).

---

## 1. Prerequisites

* **Node.js 20.9 or newer** — 22 LTS recommended (`node -v`)
* **npm** (comes with Node)
* **PostgreSQL — optional.** If you don't have it, step 3A installs a real cluster from npm for you.

## 2. Get the code

```bash
git clone -b arena/b0c3b841-live-inventory https://github.com/iwani1/Live-Inventory.git
cd Live-Inventory
npm install
```

(Or download the branch as a zip from GitHub → *Code* → *Download ZIP*, unpack, `npm install`.)

## 3. Database — pick one

### A. Zero-install PostgreSQL (easiest)

```bash
npm run db:local
```

Boots PostgreSQL 18 into `./.pgdata` (git-ignored), creates the `app_db` database, and writes `.env`
for you if it doesn't exist. **Leave this terminal running** — `Ctrl+C` stops the cluster, your data stays.

> It uses the optional `embedded-postgres` dependency, which needs npm's post-install scripts to run
> (it creates symlinks Postgres requires). If you use **pnpm**, run `pnpm approve-builds`; if you
> install with `--ignore-scripts`, run `npm i -D embedded-postgres` normally instead.
> Port 5432 busy? `PGPORT=5433 npm run db:local` and update `DATABASE_URL` in `.env` to match.

### B. Docker

```bash
docker run -d --name ember-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=app_db -p 5432:5432 postgres:16
```

### C. A Postgres you already have (local, Neon, Supabase, RDS)

Create `.env` yourself:

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DBNAME
SESSION_SECRET=any-long-random-string
```

For hosted providers append `?sslmode=require` if they require TLS.

## 4. Create the tables (first run only)

```bash
npm run db:push        # drizzle-kit push → 22 tables
```

## 5. Run the app

In a **second terminal**:

```bash
npm run dev
```

Open **http://localhost:3000**. The app seeds itself on the first request (~2 s): 5 staff, 20 menu
items, 25 ingredients, 38 recipes, 3 suppliers, 11 tables and 14 days of historical sales (≈ $3,621).

**Sign in with the PIN pad** — it submits itself on the fourth digit:

| Role | Person | PIN | Lands on |
| --- | --- | --- | --- |
| Admin | Ava Sterling | `0000` | Overview (everything unlocked) |
| Manager | Marco Reyes | `1111` | Overview (no user admin) |
| Cashier | Casey Chen | `2222` | Overview (POS, no refunds/voids/inventory) |
| Cook | Kofi Mensah | `3333` | Kitchen display only |
| Accountant | Priya Nair | `4444` | Reports only |

## 6. Optional extras

```bash
npm run demo        # drives the running app over HTTP and asserts against PostgreSQL (~65 checks)
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run build && npm start   # production mode
```

`npm run demo` needs the dev server running and writes its artefacts to `demo-output/`
(CSV exports, receipt HTML, transcript, `summary.json`).

---

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `DATABASE_URL is required` | No `.env`. Do step 3A (writes it for you) or 3C. |
| `npm run db:local` says *embedded-postgres is not installed* | `npm i -D embedded-postgres`, or use Docker/hosted Postgres (3B/3C). |
| `Could not start PostgreSQL … address already in use` | Something owns 5432. `PGPORT=5433 npm run db:local`, then set `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/app_db` in `.env`. |
| `Another next dev server is already running` | Next 16 allows one dev server per project directory. `kill <PID>` (the message names it) and re-run. |
| `relation "users" does not exist` | You skipped `npm run db:push`. |
| Login loops back to the PIN pad | Locally this means the cookie isn't being stored. Check `.env` has **no** `COOKIE_SAMESITE` and **no** `DEMO_AUTOLOGIN` line — both exist only for the sandboxed iframe preview (`COOKIE_SAMESITE=none` marks the cookie `Secure`, which some browsers then refuse over plain `http://localhost`). Also check your browser isn't blocking cookies for localhost. |
| Keypad does nothing when you tap digits | Stale browser tab. After a rebuild (especially if `.next` was deleted) the server-action IDs rotate, so an old bundle posts IDs the server no longer knows. **Hard-refresh**: `Cmd/Ctrl + Shift + R`. |
| `Failed to download Inter / Space Grotesk from Google Fonts` | No internet access to Google Fonts. Cosmetic — the app falls back to system fonts. |
| Want a pristine database again | Option A: `Ctrl+C` the cluster, `rm -rf .pgdata`, `npm run db:local`, `npm run db:push`. Any Postgres: `drop schema public cascade; create schema public;` then `npm run db:push`. Restart `next dev` afterwards so the in-process "already seeded" flag resets. |

## What changed vs. the original archive

The zip ran as-is except for three fixes, all in the commit history of this branch:

1. **`src/actions/pos.ts`** — `sendToKitchen` used `` sql`… = any(${itemIds})` ``; Drizzle expands an
   interpolated array into a comma-separated parameter list, so *every* order creation failed
   (`malformed array literal` / `op ANY/ALL (array) requires array on right side`). Now `inArray()`.
2. **`src/actions/pos.ts`** — `refundOrder` didn't expand combos, so refunding a combo restocked none of
   its ingredients. Both payment and refund now share one `lineSources()` helper.
3. **`drizzle.config.json` → `drizzle.config.ts`** — the config hard-coded one connection string and
   ignored `DATABASE_URL`; it now reads `.env`.

Plus additions: `scripts/demo.mjs`, `scripts/dev-db.mjs`, `.env.example`, `.gitignore`, npm scripts
(`db:push`, `db:generate`, `db:local`, `demo`), `allowedDevOrigins` in `next.config.ts`, the opt-in
cross-site session cookie (`COOKIE_SAMESITE=none`) and the dev-only `DEMO_AUTOLOGIN` preview escape
hatch in `src/lib/auth.ts` + `src/proxy.ts` — **both flags are sandbox-preview only; leave them unset
locally.** Full findings: `ANALYSIS.md`.
