"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Users, Clock, ShoppingBag, Bike } from "lucide-react";
import { money, minsAgo } from "@/lib/format";

export type TableCard = {
  id: number; name: string; seats: number;
  x: number; y: number; w: number; h: number; shape: string;
  order: { id: number; orderNo: string; totalCents: number; openedAt: string; items: number } | null;
};

export function TablesClient({ cards, offFloor }: {
  cards: TableCard[];
  offFloor: { id: number; orderNo: string; type: string; totalCents: number; createdAt: string }[];
}) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 10000);
    return () => clearInterval(t);
  }, [router]);

  const occupied = cards.filter((c) => c.order).length;
  const revenueOnFloor = cards.reduce((s, c) => s + (c.order?.totalCents ?? 0), 0);

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Floor plan</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {occupied}/{cards.length} tables occupied · {money(revenueOnFloor)} on the floor
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs font-semibold text-zinc-400">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-zinc-700" /> Free</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-ember-500" /> Occupied</span>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-4">
        {/* floor canvas */}
        <div className="relative h-[520px] overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/40 xl:col-span-3">
          <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: "radial-gradient(circle, #fff 1px, transparent 1px)", backgroundSize: "28px 28px" }} />
          {cards.map((t) => {
            const busy = !!t.order;
            const elapsed = t.order ? minsAgo(t.order.openedAt) : 0;
            return (
              <button
                key={t.id}
                onClick={() => router.push(t.order ? `/pos?order=${t.order.id}` : `/pos?table=${t.id}`)}
                style={{ left: `${t.x}%`, top: `${t.y}%`, width: `${t.w}%`, height: `${t.h}%` }}
                className={`absolute flex flex-col items-center justify-center gap-0.5 border p-1 text-center transition-all hover:scale-[1.03] hover:shadow-xl ${
                  t.shape === "round" ? "rounded-full" : "rounded-2xl"
                } ${
                  busy
                    ? "border-ember-500/60 bg-ember-500/15 shadow-lg shadow-ember-900/30"
                    : "border-zinc-700 bg-zinc-800/70 hover:border-zinc-500"
                }`}
              >
                <span className="font-display text-sm font-bold">{t.name}</span>
                <span className="flex items-center gap-1 text-[10px] text-zinc-500"><Users className="h-2.5 w-2.5" />{t.seats}</span>
                {busy && (
                  <>
                    <span className="text-[10px] font-bold text-ember-300">{money(t.order!.totalCents)}</span>
                    <span className={`flex items-center gap-0.5 text-[9px] font-semibold ${elapsed > 45 ? "text-red-400" : "text-zinc-400"}`}>
                      <Clock className="h-2.5 w-2.5" /> {elapsed}m
                    </span>
                  </>
                )}
              </button>
            );
          })}
        </div>

        {/* counter orders */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-300">Counter &amp; delivery tickets</h2>
          {offFloor.length === 0 && (
            <p className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 text-sm text-zinc-500">No open counter tickets.</p>
          )}
          {offFloor.map((o) => (
            <button key={o.id} onClick={() => router.push(`/pos?order=${o.id}`)}
              className="flex w-full items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 text-left transition-colors hover:border-ember-500/40">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-800 text-ember-400">
                {o.type === "delivery" ? <Bike className="h-4 w-4" /> : <ShoppingBag className="h-4 w-4" />}
              </div>
              <div className="flex-1">
                <div className="text-sm font-bold">{o.orderNo}</div>
                <div className="text-xs capitalize text-zinc-500">{o.type.replace("_", "-")} · {minsAgo(o.createdAt)}m ago</div>
              </div>
              <div className="text-sm font-bold">{money(o.totalCents)}</div>
            </button>
          ))}
          <p className="px-1 text-[11px] leading-relaxed text-zinc-600">
            Tap a free table to open a ticket for it. Tap an occupied table to reopen its order in the POS terminal.
          </p>
        </div>
      </div>
    </div>
  );
}
