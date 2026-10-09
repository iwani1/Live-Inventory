"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, Printer, RotateCcw, Ban, ChevronDown, UtensilsCrossed, ShoppingBag, Bike } from "lucide-react";
import { money, dateTime } from "@/lib/format";
import { refundOrder, voidOrder } from "@/actions/pos";

export type OrderRow = {
  id: number; order_no: string; type: string; status: string;
  subtotal_cents: number; discount_cents: number; tax_cents: number;
  tip_cents: number; total_cents: number; cogs_cents: number;
  refund_reason: string | null; created_at: string;
  table_name: string | null; opened_by: string | null;
  lines: { id: number; name: string; qty: number; unitPriceCents: number; modifiers: { name: string; priceCents: number }[]; status: string; seat: number }[];
  payments: { method: string; amountCents: number; refunded: boolean }[];
};

const STATUS_STYLE: Record<string, string> = {
  open: "bg-amber-500/15 text-amber-400",
  completed: "bg-emerald-500/15 text-emerald-400",
  refunded: "bg-red-500/15 text-red-400",
  voided: "bg-zinc-700/40 text-zinc-400",
};

export function OrdersClient({ rows, canRefund, canVoid }: {
  rows: OrderRow[]; canRefund: boolean; canVoid: boolean;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  const filtered = rows.filter((r) =>
    (filter === "all" || r.status === filter) &&
    (q === "" || r.order_no.toLowerCase().includes(q.toLowerCase())),
  );

  const act = (fn: () => Promise<{ error?: string }>) =>
    startTransition(async () => {
      const res = await fn();
      if (res.error) alert(res.error);
      router.refresh();
    });

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Orders</h1>
          <p className="mt-1 text-sm text-zinc-500">{rows.length} recent tickets · refunds &amp; voids are audit-logged</p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order #"
            className="w-56 rounded-xl border border-zinc-800 bg-zinc-900 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-ember-500" />
        </div>
      </div>

      <div className="mb-4 flex gap-2">
        {["all", "open", "completed", "refunded", "voided"].map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`rounded-full px-4 py-1.5 text-xs font-bold capitalize ${filter === f ? "bg-ember-600 text-white" : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800"}`}>
            {f} {f !== "all" && `(${rows.filter((r) => r.status === f).length})`}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {filtered.map((o) => (
          <div key={o.id} className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50">
            <button onClick={() => setExpanded(expanded === o.id ? null : o.id)}
              className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-zinc-900">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-800 text-ember-400">
                {o.type === "delivery" ? <Bike className="h-4 w-4" /> : o.type === "takeaway" ? <ShoppingBag className="h-4 w-4" /> : <UtensilsCrossed className="h-4 w-4" />}
              </div>
              <div className="w-24">
                <div className="text-sm font-bold">{o.order_no}</div>
                <div className="text-[11px] text-zinc-500">{o.table_name ?? o.type.replace("_", "-")}</div>
              </div>
              <div className="hidden flex-1 text-xs text-zinc-500 sm:block">
                {dateTime(o.created_at)} · {o.opened_by ?? "—"}
              </div>
              <div className="hidden text-xs text-zinc-500 md:block">{o.lines.reduce((s, l) => s + l.qty, 0)} items</div>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold capitalize ${STATUS_STYLE[o.status]}`}>{o.status}</span>
              <span className="w-24 text-right font-display text-base font-bold">{money(o.total_cents)}</span>
              <ChevronDown className={`h-4 w-4 text-zinc-500 transition-transform ${expanded === o.id ? "rotate-180" : ""}`} />
            </button>

            {expanded === o.id && (
              <div className="grid gap-4 border-t border-zinc-800 px-5 py-4 lg:grid-cols-3">
                <div>
                  <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-500">Items</h4>
                  {o.lines.map((l) => (
                    <div key={l.id} className="mb-1 flex justify-between text-sm">
                      <span>{l.qty}× {l.name}
                        {l.modifiers.length > 0 && <span className="text-xs text-zinc-500"> ({l.modifiers.map((m) => m.name).join(", ")})</span>}
                      </span>
                      <span className="text-zinc-400">{money(l.unitPriceCents * l.qty)}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-500">Totals</h4>
                  <div className="space-y-1 text-sm text-zinc-400">
                    <div className="flex justify-between"><span>Subtotal</span><span>{money(o.subtotal_cents)}</span></div>
                    {o.discount_cents > 0 && <div className="flex justify-between text-emerald-400"><span>Discount</span><span>-{money(o.discount_cents)}</span></div>}
                    <div className="flex justify-between"><span>Tax</span><span>{money(o.tax_cents)}</span></div>
                    {o.tip_cents > 0 && <div className="flex justify-between"><span>Tip</span><span>{money(o.tip_cents)}</span></div>}
                    <div className="flex justify-between border-t border-zinc-800 pt-1 font-bold text-zinc-100"><span>Total</span><span>{money(o.total_cents)}</span></div>
                    {o.cogs_cents > 0 && <div className="flex justify-between text-xs"><span>FIFO COGS</span><span>{money(o.cogs_cents)} ({Math.round((o.cogs_cents / Math.max(o.subtotal_cents, 1)) * 100)}%)</span></div>}
                  </div>
                  {o.payments.length > 0 && (
                    <div className="mt-3 space-y-1">
                      {o.payments.map((p, i) => (
                        <div key={i} className="flex justify-between text-xs text-zinc-500">
                          <span className="uppercase">{p.method}{p.refunded ? " (refunded)" : ""}</span><span>{money(p.amountCents)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <a href={`/receipt/${o.id}?print=1`} target="_blank"
                    className="flex items-center justify-center gap-2 rounded-xl border border-zinc-800 py-2.5 text-xs font-bold text-zinc-300 hover:border-zinc-600">
                    <Printer className="h-3.5 w-3.5" /> Print receipt
                  </a>
                  {o.status === "open" && (
                    <button onClick={() => router.push(`/pos?order=${o.id}`)}
                      className="rounded-xl bg-zinc-800 py-2.5 text-xs font-bold hover:bg-zinc-700">Reopen in POS</button>
                  )}
                  {canRefund && o.status === "completed" && (
                    <button disabled={pending} onClick={() => {
                      const reason = prompt("Refund reason (recorded in audit log):");
                      if (reason) act(() => refundOrder(o.id, reason));
                    }} className="flex items-center justify-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 py-2.5 text-xs font-bold text-red-300 hover:bg-red-500/20 disabled:opacity-50">
                      <RotateCcw className="h-3.5 w-3.5" /> Refund &amp; restock
                    </button>
                  )}
                  {canVoid && o.status === "open" && (
                    <button disabled={pending} onClick={() => {
                      const reason = prompt("Void reason (recorded in audit log):");
                      if (reason) act(() => voidOrder(o.id, reason));
                    }} className="flex items-center justify-center gap-2 rounded-xl border border-zinc-700 py-2.5 text-xs font-bold text-zinc-400 hover:bg-zinc-800 disabled:opacity-50">
                      <Ban className="h-3.5 w-3.5" /> Void ticket
                    </button>
                  )}
                  {o.refund_reason && <p className="text-center text-[11px] text-zinc-500">Reason: {o.refund_reason}</p>}
                </div>
              </div>
            )}
          </div>
        ))}
        {!filtered.length && <p className="py-12 text-center text-sm text-zinc-600">No orders match.</p>}
      </div>
    </div>
  );
}
