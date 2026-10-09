"use client";

import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { Flame, Play, CheckCheck, ConciergeBell, Armchair, UtensilsCrossed, ShoppingBag, Bike } from "lucide-react";
import { bumpTicket, bumpLine } from "@/actions/kds";
import { minsAgo } from "@/lib/format";

export type Ticket = {
  orderId: number; orderNo: string; type: string; tableName: string | null; createdAt: string;
  lines: {
    id: number; name: string; qty: number; seat: number; status: string; notes: string | null;
    modifiers: { name: string; priceCents: number }[];
  }[];
};

function stageOf(t: Ticket): "fired" | "preparing" | "ready" {
  if (t.lines.some((l) => l.status === "fired")) return "fired";
  if (t.lines.some((l) => l.status === "preparing")) return "preparing";
  return "ready";
}

export function KitchenClient({ tickets }: { tickets: Ticket[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  useEffect(() => {
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [router]);

  const act = (orderId: number, action: "start" | "ready" | "serve") =>
    startTransition(async () => { await bumpTicket(orderId, action); router.refresh(); });

  const cols: { key: "fired" | "preparing" | "ready"; title: string }[] = [
    { key: "fired", title: "New orders" },
    { key: "preparing", title: "On the fire" },
    { key: "ready", title: "Ready to serve" },
  ];

  return (
    <div className="flex h-full flex-col p-5">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 font-display text-3xl font-bold tracking-tight">
            <Flame className="h-7 w-7 text-ember-500" /> Kitchen display
          </h1>
          <p className="mt-1 text-sm text-zinc-500">{tickets.length} active tickets · auto-refreshes every 5s</p>
        </div>
        <div className="flex items-center gap-4 text-xs font-semibold text-zinc-400">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-400" /> on time</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-400" /> 8+ min</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-red-400" /> 15+ min</span>
        </div>
      </div>

      <div className="grid flex-1 gap-4 overflow-y-auto lg:grid-cols-3">
        {cols.map((col) => {
          const list = tickets.filter((t) => stageOf(t) === col.key);
          return (
            <div key={col.key} className="flex flex-col rounded-2xl border border-zinc-800 bg-zinc-900/40">
              <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
                <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-300">{col.title}</h2>
                <span className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs font-bold">{list.length}</span>
              </div>
              <div className="flex-1 space-y-3 overflow-y-auto p-3">
                {list.map((t) => {
                  const elapsed = minsAgo(t.createdAt);
                  const tone = elapsed >= 15 ? "border-red-500/50" : elapsed >= 8 ? "border-amber-500/50" : "border-zinc-800";
                  return (
                    <div key={t.orderId} className={`rise-in rounded-xl border ${tone} bg-zinc-950/70`}>
                      <div className="flex items-center justify-between border-b border-zinc-800/60 px-3.5 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="font-display text-base font-bold">{t.orderNo}</span>
                          <span className="flex items-center gap-1 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-bold text-zinc-300">
                            {t.type === "delivery" ? <Bike className="h-3 w-3" /> : t.type === "takeaway" ? <ShoppingBag className="h-3 w-3" /> : <UtensilsCrossed className="h-3 w-3" />}
                            {t.tableName ?? (t.type === "dine_in" ? "dine-in" : t.type)}
                          </span>
                        </div>
                        <span className={`text-xs font-bold ${elapsed >= 15 ? "text-red-400" : elapsed >= 8 ? "text-amber-400" : "text-emerald-400"}`}>
                          {elapsed}m
                        </span>
                      </div>
                      <div className="space-y-1.5 px-3.5 py-2.5">
                        {t.lines.map((l) => (
                          <div key={l.id} className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold">
                                <span className="mr-1.5 text-ember-400">{l.qty}×</span>{l.name}
                              </div>
                              {l.modifiers.length > 0 && (
                                <div className="text-xs text-zinc-500">{l.modifiers.map((m) => m.name).join(", ")}</div>
                              )}
                              {l.notes && <div className="text-xs font-semibold text-sky-400">“{l.notes}”</div>}
                            </div>
                            <button
                              onClick={() => startTransition(async () => { await bumpLine(l.id, l.status === "fired" ? "start" : l.status === "preparing" ? "ready" : "serve"); router.refresh(); })}
                              className={`mt-0.5 flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                                l.status === "fired" ? "bg-amber-500/15 text-amber-400"
                                : l.status === "preparing" ? "bg-sky-500/15 text-sky-400"
                                : "bg-emerald-500/15 text-emerald-400"
                              }`}>
                              <Armchair className="h-2.5 w-2.5" />S{l.seat} {l.status}
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="px-3.5 pb-3">
                        {col.key === "fired" && (
                          <button onClick={() => act(t.orderId, "start")}
                            className="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-600 py-2.5 text-xs font-bold text-white hover:bg-sky-500">
                            <Play className="h-3.5 w-3.5" /> Start all
                          </button>
                        )}
                        {col.key === "preparing" && (
                          <button onClick={() => act(t.orderId, "ready")}
                            className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2.5 text-xs font-bold text-white hover:bg-emerald-500">
                            <CheckCheck className="h-3.5 w-3.5" /> Mark ready
                          </button>
                        )}
                        {col.key === "ready" && (
                          <button onClick={() => act(t.orderId, "serve")}
                            className="flex w-full items-center justify-center gap-2 rounded-lg bg-zinc-700 py-2.5 text-xs font-bold text-white hover:bg-zinc-600">
                            <ConciergeBell className="h-3.5 w-3.5" /> Serve &amp; clear
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {list.length === 0 && (
                  <p className="py-8 text-center text-sm text-zinc-600">No tickets</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
