// Lightweight signed-cookie session + PIN hashing.
// Production note: swap for a managed IdP / next-auth with refresh tokens.
import { createHmac, createHash } from "crypto";
import { cookies } from "next/headers";

const SECRET = process.env.SESSION_SECRET || "ember-dev-secret-change-in-production";
const COOKIE = "ember_session";

export type Session = { id: number; name: string; role: string };

function sign(data: string): string {
  return createHmac("sha256", SECRET).update(data).digest("base64url");
}

export function hashPin(pin: string): string {
  return createHash("sha256").update(pin + "|ember-pos").digest("hex");
}

export function verifyPin(pin: string, storedHash: string): boolean {
  return hashPin(pin) === storedHash;
}

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const raw = store.get(COOKIE)?.value;
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot < 0) return null;
  const b64 = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  if (sign(b64) !== sig) return null;
  try {
    return JSON.parse(Buffer.from(b64, "base64url").toString("utf8")) as Session;
  } catch {
    return null;
  }
}

export async function setSessionCookie(s: Session): Promise<void> {
  const b64 = Buffer.from(JSON.stringify(s), "utf8").toString("base64url");
  const store = await cookies();
  store.set(COOKIE, `${b64}.${sign(b64)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12, // 12h shift-length session
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
}
