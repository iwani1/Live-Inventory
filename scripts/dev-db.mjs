#!/usr/bin/env node
/**
 * Local development database — zero-install PostgreSQL.
 *
 * Boots a real PostgreSQL cluster from the npm-published binaries
 * (`embedded-postgres`), stores it in ./.pgdata (git-ignored), creates the
 * `app_db` database and makes sure `.env` points at it.
 *
 *   npm i -D embedded-postgres      # once
 *   npm run db:local                # foreground: Ctrl+C stops the cluster
 *   npm run db:push                 # create the 22 tables
 *   npm run dev                     # http://localhost:3000  (seeds itself)
 *
 * Already run Postgres (or Docker/Neon/Supabase)? Skip this script entirely and
 * just set DATABASE_URL in .env.
 *
 * Env overrides: PGPORT (5432), PGDATABASE (app_db), PGUSER (postgres),
 *                PGPASSWORD (postgres)
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = path.resolve(import.meta.dirname, "..");
const DATA_DIR = path.join(ROOT, ".pgdata");
const PORT = Number(process.env.PGPORT ?? 5432);
const DB = process.env.PGDATABASE ?? "app_db";
const USER = process.env.PGUSER ?? "postgres";
const PASSWORD = process.env.PGPASSWORD ?? "postgres";
const URL = `postgresql://${USER}:${PASSWORD}@127.0.0.1:${PORT}/${DB}`;

let EmbeddedPostgres;
try {
  ({ default: EmbeddedPostgres } = await import("embedded-postgres"));
} catch {
  console.error(`
\x1b[31membedded-postgres is not installed.\x1b[0m

  Option A — zero-install Postgres (recommended if you don't have one):
      npm i -D embedded-postgres
      npm run db:local

  Option B — use a Postgres you already have:
      docker run -d --name ember-pg -e POSTGRES_PASSWORD=postgres \\
        -e POSTGRES_DB=${DB} -p ${PORT}:5432 postgres:16
    then put this in .env:
      DATABASE_URL=${URL}

  Option C — hosted (Neon / Supabase / RDS): put their connection string in
    .env as DATABASE_URL (append ?sslmode=require if they need TLS).

Then: npm run db:push && npm run dev
`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// make sure .env exists and points at this cluster
// ---------------------------------------------------------------------------
const ENV_PATH = path.join(ROOT, ".env");
const secret = crypto.randomBytes(24).toString("base64url");
if (!fs.existsSync(ENV_PATH)) {
  fs.writeFileSync(
    ENV_PATH,
    `DATABASE_URL=${URL}\nSESSION_SECRET=${secret}\n`,
  );
  console.log(`✓ wrote .env (DATABASE_URL + a fresh SESSION_SECRET)`);
} else {
  const env = fs.readFileSync(ENV_PATH, "utf8");
  if (!/^DATABASE_URL=/m.test(env)) {
    fs.appendFileSync(ENV_PATH, `\nDATABASE_URL=${URL}\n`);
    console.log(`✓ appended DATABASE_URL to .env`);
  }
  if (!/^SESSION_SECRET=/m.test(env)) {
    fs.appendFileSync(ENV_PATH, `SESSION_SECRET=${secret}\n`);
    console.log(`✓ appended SESSION_SECRET to .env`);
  }
}

// ---------------------------------------------------------------------------
// boot the cluster
// ---------------------------------------------------------------------------
const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: USER,
  password: PASSWORD,
  port: PORT,
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  postgresFlags: ["-c", `listen_addresses=127.0.0.1`],
  onLog: (m) => process.env.DB_VERBOSE && process.stdout.write(m),
  onError: (e) => console.error("[db]", e?.message ?? e),
});

const fresh = !fs.existsSync(path.join(DATA_DIR, "PG_VERSION"));
try {
  if (fresh) {
    console.log(`• initialising a new cluster in .pgdata (first run only)…`);
    await pg.initialise();
  } else {
    console.log(`• reusing the existing cluster in .pgdata`);
  }
  await pg.start();

  const admin = pg.getPgClient("postgres", "127.0.0.1");
  await admin.connect();
  const { rows } = await admin.query("select 1 from pg_database where datname = $1", [DB]);
  if (!rows.length) {
    await admin.query(`create database ${DB}`);
    console.log(`✓ created database "${DB}"`);
  }
  await admin.end();
} catch (err) {
  console.error(`\n\x1b[31mCould not start PostgreSQL on 127.0.0.1:${PORT}.\x1b[0m`);
  console.error(
    err?.message?.includes("address already in use") || String(err).includes("in use")
      ? `  Something is already listening on port ${PORT}. Either stop it, or run this on\n  another port and update .env:\n      PGPORT=5433 npm run db:local\n      DATABASE_URL=postgresql://${USER}:${PASSWORD}@127.0.0.1:5433/${DB}`
      : `  ${err?.message ?? err}`,
  );
  process.exit(1);
}

console.log(`
\x1b[32m✓ PostgreSQL is ready\x1b[0m
  \x1b[1m${URL}\x1b[0m

Next, in a second terminal:
  npm run db:push     # create the 22 tables (first run only)
  npm run dev         # http://localhost:3000 — the app seeds itself on first request

Demo PINs: admin 0000 · manager 1111 · cashier 2222 · cook 3333 · accountant 4444

Leave this terminal running; Ctrl+C stops the cluster (your data stays in .pgdata).
`);

// keep the supervisor alive — embedded-postgres stops the cluster when we exit
setInterval(() => {}, 1 << 30);
