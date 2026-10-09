"use server";

import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSession, hashPin } from "@/lib/auth";
import { can, ROLES } from "@/lib/perms";
import { audit } from "@/lib/audit";
import { ensureSeeded } from "@/db/seed";

async function guardAdmin() {
  await ensureSeeded();
  const session = await getSession();
  if (!session) return { error: "Not signed in" as const };
  if (!can(session.role, "team")) return { error: "Admin access required." as const };
  return { session };
}

export async function saveUser(input: {
  id?: number; name: string; role: string; pin?: string; active?: boolean;
}): Promise<{ error?: string }> {
  const guard = await guardAdmin();
  if ("error" in guard) return { error: guard.error };
  if (!input.name.trim()) return { error: "Name is required." };
  if (!ROLES.includes(input.role as (typeof ROLES)[number])) return { error: "Invalid role." };

  if (input.id) {
    await db.update(users).set({ name: input.name.trim(), role: input.role }).where(eq(users.id, input.id));
    if (input.pin) {
      if (!/^\d{4,6}$/.test(input.pin)) return { error: "PIN must be 4–6 digits." };
      await db.update(users).set({ pinHash: hashPin(input.pin) }).where(eq(users.id, input.id));
    }
    await audit(guard.session, "user.update", "user", input.id, { role: input.role, pinChanged: !!input.pin });
  } else {
    if (!input.pin || !/^\d{4,6}$/.test(input.pin)) return { error: "PIN must be 4–6 digits." };
    await db.insert(users).values({ name: input.name.trim(), role: input.role, pinHash: hashPin(input.pin) });
    await audit(guard.session, "user.create", "user", null, { name: input.name, role: input.role });
  }
  return {};
}

export async function toggleUserActive(id: number): Promise<{ error?: string }> {
  const guard = await guardAdmin();
  if ("error" in guard) return { error: guard.error };
  if (id === guard.session.id) return { error: "You can't deactivate yourself." };
  const [u] = await db.select().from(users).where(eq(users.id, id));
  if (!u) return { error: "User not found." };
  await db.update(users).set({ active: !u.active }).where(eq(users.id, id));
  await audit(guard.session, u.active ? "user.deactivate" : "user.activate", "user", id, {});
  return {};
}
