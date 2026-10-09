import { db } from "@/db";
import { auditLogs } from "@/db/schema";

export async function audit(
  user: { id: number; name: string } | null,
  action: string,
  entity: string,
  entityId: string | number | null,
  meta?: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      userId: user?.id ?? null,
      userName: user?.name ?? "system",
      action,
      entity,
      entityId: entityId != null ? String(entityId) : null,
      meta: meta ?? null,
    });
  } catch (e) {
    console.error("[audit] failed", e);
  }
}
