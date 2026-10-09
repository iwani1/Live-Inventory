// Lightweight signed-cookie session + PIN hashing.
// Production note: swap for a managed IdP / next-auth with refresh tokens.
import { createHmac, createHash } from "crypto";
import { cookies } from "next/headers";
import { db } from "@/db";
import { users } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";

const SECRET = process.env.SESSION_SECRET || "ember-dev-secret-change-in-production";
const COOKIE = "ember_session";

export type Session = { id: number; name: string; role: string };

/**
 * Demo affordance for cookie-hostile embeds.
 *
 * When the app is shown inside a cross-site iframe whose browser refuses
 * third-party cookies (some sandbox previews, Safari ITP), a session can never
 * persist: login succeeds and the next request looks anonymous again. Setting
 * DEMO_AUTOLOGIN=<role> makes every cookie-less request resolve to that staff
 * account so the UI stays explorable.
 *
 * Development only — it is inert when NODE_ENV=production. Never set it on a
 * real deployment: it is, by design, an authentication bypass.
 */
const DEMO_ROLE = (process.env.DEMO_AUTOLOGIN ?? "").trim().toLowerCase();
export const demoAutoLogin =
  process.env.NODE_ENV !== "production" && DEMO_ROLE.length > 0;

function sign(data: string): string {
  return createHmac("sha256", SECRET).update(data).digest("base64url");
}

export function hashPin(pin: string): string {
  return createHash("sha256").update(pin + "|ember-pos").digest("hex");
}

export function verifyPin(pin: string, storedHash: string): boolean {
  return hashPin(pin) === storedHash;
}

function decodeSession(raw: string): Session | null {
  const dot = raw.lastIndexOf(".");
  if (dot < 0) return null;
  const b64 = raw.slice(0, dot);
  if (sign(b64) !== raw.slice(dot + 1)) return null;
  try {
    return JSON.parse(Buffer.from(b64, "base64url").toString("utf8")) as Session;
  } catch {
    return null;
  }
}

let cachedDemoSession: Promise<Session | null> | null = null;
let warned = false;

function demoSession(): Promise<Session | null> {
  cachedDemoSession ??= db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(and(eq(users.role, DEMO_ROLE), eq(users.active, true)))
    .orderBy(asc(users.id))
    .limit(1)
    .then((rows) => rows[0] ?? null)
    .catch(() => null);
  return cachedDemoSession;
}

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const raw = store.get(COOKIE)?.value;
  if (raw) {
    const session = decodeSession(raw);
    if (session) return session;
  }
  if (!demoAutoLogin) return null;
  const demo = await demoSession();
  if (demo && !warned) {
    warned = true;
    console.warn(
      `[auth] DEMO_AUTOLOGIN=${DEMO_ROLE}: cookie-less requests are signed in as ` +
        `${demo.name} (${demo.role}). Development only — never set this in production.`,
    );
  }
  return demo;
}

/**
 * Cookie attributes.
 *
 * Default (`lax`) is the right posture for a normally-served site. When the app
 * is embedded in a cross-site iframe — e.g. a sandboxed live preview — a Lax
 * cookie is never sent back: login succeeds server-side, then the very next
 * request looks anonymous and the proxy bounces the user to /login again.
 * Set `COOKIE_SAMESITE=none` to opt into the attributes cross-site contexts
 * require (SameSite=None; Secure; Partitioned). Partitioned (CHIPS) keeps the
 * cookie scoped to the embedding site, and browsers that don't know the
 * attribute simply ignore it.
 */
const CROSS_SITE_COOKIE = (process.env.COOKIE_SAMESITE ?? "lax").toLowerCase() === "none";

function sessionCookieAttributes() {
  return CROSS_SITE_COOKIE
    ? ({ sameSite: "none", secure: true, partitioned: true } as const)
    : ({ sameSite: "lax", secure: process.env.NODE_ENV === "production" } as const);
}

export async function setSessionCookie(s: Session): Promise<void> {
  const b64 = Buffer.from(JSON.stringify(s), "utf8").toString("base64url");
  const store = await cookies();
  store.set(COOKIE, `${b64}.${sign(b64)}`, {
    httpOnly: true,
    path: "/",
    maxAge: 60 * 60 * 12, // 12h shift-length session
    ...sessionCookieAttributes(),
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  // deletion must carry the same attributes or the browser keeps the old cookie
  store.delete({ name: COOKIE, httpOnly: true, path: "/", ...sessionCookieAttributes() });
}
