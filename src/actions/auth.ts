"use server";

import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyPin, setSessionCookie, clearSessionCookie } from "@/lib/auth";
import { homeFor } from "@/lib/perms";
import { redirect } from "next/navigation";
import { ensureSeeded } from "@/db/seed";
import { audit } from "@/lib/audit";

export async function loginWithPin(userId: number, pin: string): Promise<{ error?: string; home?: string }> {
  await ensureSeeded();
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u || !u.active) return { error: "This account is not available." };
  if (!verifyPin(pin, u.pinHash)) return { error: "Incorrect PIN — try again." };
  await setSessionCookie({ id: u.id, name: u.name, role: u.role });
  await audit({ id: u.id, name: u.name }, "auth.login", "user", u.id, { role: u.role });
  return { home: homeFor(u.role) };
}

export async function logout(): Promise<void> {
  await clearSessionCookie();
  redirect("/login");
}
