import { db } from "@/db";
import { sql } from "drizzle-orm";
import { ensureSeeded } from "@/db/seed";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/perms";
import { redirect } from "next/navigation";
import { AdminClient, type AdminUser, type AuditRow } from "./admin-client";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  await ensureSeeded();
  const session = await getSession();
  if (!session || !can(session.role, "team")) redirect("/");

  const users = await db.execute(sql`
    select u.id, u.name, u.role, u.active, u.created_at,
           (select count(*)::int from audit_logs a where a.user_id = u.id) as actions
    from users u order by u.id
  `).then((r) => r.rows as unknown as AdminUser[]);

  const auditRows = await db.execute(sql`
    select id, user_name, action, entity, entity_id, meta, created_at
    from audit_logs order by created_at desc limit 120
  `).then((r) => r.rows as unknown as AuditRow[]);

  return <AdminClient users={users} audit={auditRows} currentUserId={session.id} />;
}
