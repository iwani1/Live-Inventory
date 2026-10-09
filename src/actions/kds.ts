"use server";

import { db } from "@/db";
import { orderItems } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/perms";
import { audit } from "@/lib/audit";
import { ensureSeeded } from "@/db/seed";

const FLOWS: Record<string, { from: string[]; to: string }> = {
  start: { from: ["fired"], to: "preparing" },
  ready: { from: ["fired", "preparing"], to: "ready" },
  serve: { from: ["fired", "preparing", "ready"], to: "served" },
};

export async function bumpTicket(orderId: number, action: "start" | "ready" | "serve"): Promise<{ error?: string }> {
  await ensureSeeded();
  const session = await getSession();
  if (!session || (!can(session.role, "kitchen") && !can(session.role, "pos"))) {
    return { error: "Not permitted" };
  }
  const flow = FLOWS[action];
  if (!flow) return { error: "Unknown action" };
  await db.update(orderItems).set({ status: flow.to })
    .where(and(eq(orderItems.orderId, orderId), inArray(orderItems.status, flow.from)));
  await audit(session, `kds.${action}`, "order", orderId, {});
  return {};
}

export async function bumpLine(lineId: number, action: "start" | "ready" | "serve"): Promise<{ error?: string }> {
  await ensureSeeded();
  const session = await getSession();
  if (!session || (!can(session.role, "kitchen") && !can(session.role, "pos"))) {
    return { error: "Not permitted" };
  }
  const flow = FLOWS[action];
  if (!flow) return { error: "Unknown action" };
  await db.update(orderItems).set({ status: flow.to })
    .where(and(eq(orderItems.id, lineId), inArray(orderItems.status, flow.from)));
  return {};
}
