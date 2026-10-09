import { db } from "@/db";
import { orders, orderItems, payments, settings } from "@/db/schema";
import { eq, and, ne, asc } from "drizzle-orm";
import { ensureSeeded } from "@/db/seed";
import { money, dateTime } from "@/lib/format";
import { Autoprint, PrintButton } from "./autoprint";
import { notFound } from "next/navigation";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  await ensureSeeded();
  const { id } = await params;
  const oid = Number(id);
  const [ord] = await db.select().from(orders).where(eq(orders.id, oid));
  if (!ord) notFound();

  const lines = await db.select().from(orderItems)
    .where(and(eq(orderItems.orderId, oid), ne(orderItems.status, "voided")))
    .orderBy(asc(orderItems.id));
  const pays = await db.select().from(payments)
    .where(and(eq(payments.orderId, oid), eq(payments.refunded, false)));
  const s = await db.select().from(settings);
  const cfg = Object.fromEntries(s.map((r) => [r.key, r.value]));

  return (
    <div className="flex min-h-screen flex-col items-center bg-zinc-950 py-10">
      <Suspense><Autoprint /></Suspense>
      <div className="receipt-paper w-80 rounded-md bg-white p-6 font-mono text-[13px] leading-relaxed text-black shadow-2xl">
        <div className="text-center">
          <div className="text-lg font-bold uppercase tracking-widest">{cfg.restaurant_name}</div>
          <div className="text-xs">{cfg.restaurant_tagline}</div>
          <div className="text-xs">{cfg.address}</div>
        </div>
        <div className="my-3 border-t border-dashed border-zinc-400" />
        <div className="flex justify-between text-xs">
          <span>{ord.orderNo}</span>
          <span className="uppercase">{ord.type.replace("_", "-")}</span>
        </div>
        <div className="text-xs">{dateTime(ord.createdAt)}</div>
        {ord.customerName && <div className="text-xs">Customer: {ord.customerName} {ord.customerPhone}</div>}
        {ord.deliveryAddress && <div className="text-xs">Deliver to: {ord.deliveryAddress}</div>}
        <div className="my-3 border-t border-dashed border-zinc-400" />
        {lines.map((l) => (
          <div key={l.id} className="mb-1.5">
            <div className="flex justify-between">
              <span>{l.qty}× {l.name}</span>
              <span>{money(l.unitPriceCents * l.qty)}</span>
            </div>
            {l.modifiers.map((m, i) => (
              <div key={i} className="flex justify-between pl-4 text-xs text-zinc-600">
                <span>+ {m.name}</span>
                {m.priceCents > 0 && <span>{money(m.priceCents * l.qty)}</span>}
              </div>
            ))}
            {l.notes && <div className="pl-4 text-xs italic">“{l.notes}”</div>}
          </div>
        ))}
        <div className="my-3 border-t border-dashed border-zinc-400" />
        <div className="space-y-0.5">
          <div className="flex justify-between"><span>Subtotal</span><span>{money(ord.subtotalCents)}</span></div>
          {ord.discountCents > 0 && <div className="flex justify-between"><span>Discount</span><span>-{money(ord.discountCents)}</span></div>}
          <div className="flex justify-between"><span>Tax ({(Number(cfg.tax_rate_bps ?? 850) / 100).toFixed(2)}%)</span><span>{money(ord.taxCents)}</span></div>
          {ord.tipCents > 0 && <div className="flex justify-between"><span>Tip</span><span>{money(ord.tipCents)}</span></div>}
          <div className="mt-1 flex justify-between border-t border-black pt-1 text-base font-bold">
            <span>TOTAL</span><span>{money(ord.totalCents)}</span>
          </div>
        </div>
        <div className="my-3 border-t border-dashed border-zinc-400" />
        {pays.length > 0 ? (
          pays.map((p, i) => (
            <div key={i} className="flex justify-between text-xs">
              <span className="uppercase">{p.method}{p.seat ? ` · seat ${p.seat}` : ""}</span>
              <span>{money(p.amountCents)}</span>
            </div>
          ))
        ) : (
          <div className="text-center text-xs uppercase tracking-widest">— open ticket —</div>
        )}
        {ord.status === "refunded" && (
          <div className="mt-2 text-center text-sm font-bold uppercase tracking-widest">*** refunded ***</div>
        )}
        {ord.status === "voided" && (
          <div className="mt-2 text-center text-sm font-bold uppercase tracking-widest">*** voided ***</div>
        )}
        <div className="mt-4 text-center text-xs">
          <div>Thank you for dining with us.</div>
          <div className="mt-1 text-[10px]">Powered by Ember POS</div>
        </div>
      </div>
      <div className="no-print mt-6 flex gap-3">
        <a href="/pos" className="rounded-xl border border-zinc-700 px-5 py-2.5 text-sm font-semibold text-zinc-300 hover:bg-zinc-800">Back to POS</a>
        <PrintButton />
      </div>
    </div>
  );
}
