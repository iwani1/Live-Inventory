"use server";

import { db } from "@/db";
import { shifts, payments, orders, timeEntries } from "@/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/perms";
import { audit } from "@/lib/audit";
import { ensureSeeded } from "@/db/seed";

async function guardShift() {
  await ensureSeeded();
  const session = await getSession();
  if (!session) return { error: "Not signed in" as const };
  if (!can(session.role, "shifts")) return { error: "No shift permissions." as const };
  return { session };
}

export async function openShift(openingCashCents: number): Promise<{ error?: string }> {
  const guard = await guardShift();
  if ("error" in guard) return { error: guard.error };
  const [existing] = await db.select().from(shifts)
    .where(and(eq(shifts.userId, guard.session.id), eq(shifts.status, "open")));
  if (existing) return { error: "You already have an open shift." };
  await db.insert(shifts).values({
    userId: guard.session.id, openingCashCents: Math.max(0, Math.round(openingCashCents)), status: "open",
  });
  await audit(guard.session, "shift.open", "shift", null, { openingCashCents });
  return {};
}

export async function closeShift(countedCashCents: number, notes: string): Promise<{ error?: string; varianceCents?: number }> {
  const guard = await guardShift();
  if ("error" in guard) return { error: guard.error };
  const [shift] = await db.select().from(shifts)
    .where(and(eq(shifts.userId, guard.session.id), eq(shifts.status, "open")));
  if (!shift) return { error: "No open shift found." };

  // expected cash = drawer opening + non-refunded cash payments taken on this shift
  const rows = await db
    .select({ total: sql<number>`coalesce(sum(${payments.amountCents}),0)::int` })
    .from(payments)
    .innerJoin(orders, eq(payments.orderId, orders.id))
    .where(and(
      eq(orders.shiftId, shift.id), eq(payments.method, "cash"), eq(payments.refunded, false),
    ));
  const cashTaken = Number(rows[0]?.total ?? 0);
  const expected = shift.openingCashCents + cashTaken;
  const counted = Math.max(0, Math.round(countedCashCents));
  const variance = counted - expected;

  await db.update(shifts).set({
    status: "closed", closedAt: new Date(),
    expectedCashCents: expected, countedCashCents: counted, varianceCents: variance, notes: notes || null,
  }).where(eq(shifts.id, shift.id));
  await audit(guard.session, "shift.close", "shift", shift.id, { expected, counted, variance });
  return { varianceCents: variance };
}

export async function clockIn(): Promise<{ error?: string }> {
  await ensureSeeded();
  const session = await getSession();
  if (!session) return { error: "Not signed in" };
  const [open] = await db.select().from(timeEntries)
    .where(and(eq(timeEntries.userId, session.id), isNull(timeEntries.clockOut)));
  if (open) return { error: "Already clocked in." };
  await db.insert(timeEntries).values({ userId: session.id });
  await audit(session, "timesheet.clock_in", "user", session.id, {});
  return {};
}

export async function clockOut(): Promise<{ error?: string }> {
  await ensureSeeded();
  const session = await getSession();
  if (!session) return { error: "Not signed in" };
  const [open] = await db.select().from(timeEntries)
    .where(and(eq(timeEntries.userId, session.id), isNull(timeEntries.clockOut)));
  if (!open) return { error: "You are not clocked in." };
  await db.update(timeEntries).set({ clockOut: new Date() }).where(eq(timeEntries.id, open.id));
  await audit(session, "timesheet.clock_out", "user", session.id, {});
  return {};
}
