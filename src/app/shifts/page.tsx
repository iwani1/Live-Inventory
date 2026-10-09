import { db } from "@/db";
import { sql } from "drizzle-orm";
import { ensureSeeded } from "@/db/seed";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/perms";
import { redirect } from "next/navigation";
import { ShiftsClient, type ShiftRow, type TimeRow } from "./shifts-client";

export const dynamic = "force-dynamic";

export default async function ShiftsPage() {
  await ensureSeeded();
  const session = await getSession();
  if (!session || !can(session.role, "shifts")) redirect("/");

  const [openShift] = await db.execute(sql`
    select s.id, s.opened_at, s.opening_cash_cents, u.name as user_name
    from shifts s join users u on u.id = s.user_id
    where s.user_id = ${session.id} and s.status = 'open' limit 1
  `).then((r) => r.rows as { id: number; opened_at: string; opening_cash_cents: number; user_name: string }[]);

  let cashTaken = 0;
  let salesTotal = 0;
  let orderCount = 0;
  if (openShift) {
    const [agg] = await db.execute(sql`
      select
        coalesce(sum(case when p.method = 'cash' and not p.refunded then p.amount_cents else 0 end),0)::int as cash_taken,
        coalesce(sum(o.total_cents) filter (where o.status = 'completed'),0)::int as sales,
        count(o.id) filter (where o.status = 'completed')::int as orders
      from orders o left join payments p on p.order_id = o.id
      where o.shift_id = ${openShift.id}
    `).then((r) => r.rows as { cash_taken: number; sales: number; orders: number }[]);
    cashTaken = agg.cash_taken;
    salesTotal = agg.sales;
    orderCount = agg.orders;
  }

  const history = await db.execute(sql`
    select s.id, s.opened_at, s.closed_at, s.opening_cash_cents, s.expected_cash_cents,
           s.counted_cash_cents, s.variance_cents, s.status, s.notes, u.name as user_name
    from shifts s join users u on u.id = s.user_id
    order by s.opened_at desc limit 12
  `).then((r) => r.rows as ShiftRow[]);

  const [clockedIn] = await db.execute(sql`
    select id from time_entries where user_id = ${session.id} and clock_out is null limit 1
  `).then((r) => r.rows as { id: number }[]);

  const canSeeTeam = can(session.role, "team") || session.role === "manager";
  const timesheets = await db.execute(sql`
    select t.id, t.clock_in, t.clock_out, u.name as user_name
    from time_entries t join users u on u.id = t.user_id
    ${canSeeTeam ? sql`` : sql`where t.user_id = ${session.id}`}
    order by t.clock_in desc limit 12
  `).then((r) => r.rows as TimeRow[]);

  return (
    <ShiftsClient
      viewerName={session.name}
      openShift={openShift ?? null}
      cashTaken={cashTaken}
      salesTotal={salesTotal}
      orderCount={orderCount}
      history={history}
      timesheets={timesheets}
      clockedIn={!!clockedIn}
    />
  );
}
