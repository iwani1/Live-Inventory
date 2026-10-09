"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock, Unlock, LogIn, LogOut, Banknote, AlertTriangle, CheckCircle2 } from "lucide-react";
import { money, dateTime, timeOnly, hoursBetween } from "@/lib/format";
import { openShift, closeShift, clockIn, clockOut } from "@/actions/shifts";

export type ShiftRow = {
  id: number; opened_at: string; closed_at: string | null;
  opening_cash_cents: number; expected_cash_cents: number | null;
  counted_cash_cents: number | null; variance_cents: number | null;
  status: string; notes: string | null; user_name: string;
};
export type TimeRow = {
  id: number; clock_in: string; clock_out: string | null; user_name: string;
};

function CashInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-zinc-500">$</span>
      <input value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))}
        inputMode="decimal" placeholder={placeholder}
        className="w-full rounded-xl border border-zinc-800 bg-zinc-950 py-3 pl-8 pr-3 font-display text-lg font-bold outline-none focus:border-ember-500" />
    </div>
  );
}
const toCents = (v: string) => Math.round(parseFloat(v || "0") * 100);

export function ShiftsClient(props: {
  viewerName: string;
  openShift: { id: number; opened_at: string; opening_cash_cents: number; user_name: string } | null;
  cashTaken: number; salesTotal: number; orderCount: number;
  history: ShiftRow[]; timesheets: TimeRow[]; clockedIn: boolean;
}) {
  const router = useRouter();
  const [opening, setOpening] = useState("200.00");
  const [counted, setCounted] = useState("");
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [result, setResult] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ error?: string; varianceCents?: number }>) =>
    startTransition(async () => {
      setMsg(null); setResult(null);
      const res = await fn();
      if (res.error) setMsg(res.error);
      if (res.varianceCents !== undefined) setResult(res.varianceCents);
      router.refresh();
    });

  const expected = (props.openShift?.opening_cash_cents ?? 0) + props.cashTaken;

  return (
    <div className="p-6 lg:p-8">
      <h1 className="font-display text-3xl font-bold tracking-tight">Shifts &amp; cash</h1>
      <p className="mt-1 text-sm text-zinc-500">Drawer reconciliation and team time clock</p>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* shift drawer */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="mb-4 flex items-center gap-2">
            <Banknote className="h-4 w-4 text-ember-400" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-300">Cash drawer</h2>
          </div>

          {!props.openShift ? (
            <div className="space-y-3">
              <p className="text-sm text-zinc-400">No open shift on your account. Count the drawer and open one.</p>
              <CashInput value={opening} onChange={setOpening} placeholder="Opening float" />
              <button disabled={pending} onClick={() => run(() => openShift(toCents(opening)))}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-ember-600 py-3 text-sm font-bold text-white hover:bg-ember-500 disabled:opacity-50">
                <Unlock className="h-4 w-4" /> Open shift
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-xl bg-zinc-950 p-3"><div className="text-[11px] text-zinc-500">Opened</div><div className="font-bold">{timeOnly(props.openShift.opened_at)}</div></div>
                <div className="rounded-xl bg-zinc-950 p-3"><div className="text-[11px] text-zinc-500">Float</div><div className="font-bold">{money(props.openShift.opening_cash_cents)}</div></div>
                <div className="rounded-xl bg-zinc-950 p-3"><div className="text-[11px] text-zinc-500">Cash sales</div><div className="font-bold">{money(props.cashTaken)}</div></div>
                <div className="rounded-xl bg-ember-500/10 p-3"><div className="text-[11px] text-ember-300/70">Expected in drawer</div><div className="font-bold text-ember-300">{money(expected)}</div></div>
              </div>
              <div className="rounded-xl bg-zinc-950 p-3 text-sm">
                <div className="flex justify-between"><span className="text-zinc-500">Shift sales (all methods)</span><span className="font-bold">{money(props.salesTotal)}</span></div>
                <div className="mt-1 flex justify-between"><span className="text-zinc-500">Completed orders</span><span className="font-bold">{props.orderCount}</span></div>
              </div>
              <CashInput value={counted} onChange={setCounted} placeholder="Counted cash in drawer" />
              <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Closing notes (optional)"
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm outline-none focus:border-ember-500" />
              <button disabled={pending || !counted} onClick={() => run(() => closeShift(toCents(counted), notes))}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-800 py-3 text-sm font-bold text-white hover:bg-zinc-700 disabled:opacity-50">
                <Lock className="h-4 w-4" /> Close shift &amp; reconcile
              </button>
              {result !== null && (
                <div className={`flex items-center gap-2 rounded-xl p-3 text-sm font-semibold ${result === 0 ? "bg-emerald-500/10 text-emerald-300" : "bg-amber-500/10 text-amber-300"}`}>
                  {result === 0 ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                  Variance: {money(result)} {result === 0 ? "· balanced" : result > 0 ? "· over" : "· short"}
                </div>
              )}
            </div>
          )}
          {msg && <p className="pt-2 text-center text-sm font-semibold text-red-400">{msg}</p>}
        </div>

        {/* time clock */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-zinc-300">Time clock</h2>
          <div className={`mb-4 rounded-xl p-4 text-center text-sm font-semibold ${props.clockedIn ? "bg-emerald-500/10 text-emerald-300" : "bg-zinc-950 text-zinc-500"}`}>
            {props.clockedIn ? "You are clocked in" : "You are clocked out"}
          </div>
          {props.clockedIn ? (
            <button disabled={pending} onClick={() => run(clockOut)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 py-3 text-sm font-bold text-red-300 hover:bg-red-500/20 disabled:opacity-50">
              <LogOut className="h-4 w-4" /> Clock out
            </button>
          ) : (
            <button disabled={pending} onClick={() => run(clockIn)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 py-3 text-sm font-bold text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50">
              <LogIn className="h-4 w-4" /> Clock in
            </button>
          )}

          <h3 className="mb-2 mt-6 text-xs font-bold uppercase tracking-wider text-zinc-500">Recent timesheets</h3>
          <div className="space-y-1.5">
            {props.timesheets.map((t) => (
              <div key={t.id} className="flex items-center justify-between rounded-lg bg-zinc-950 px-3 py-2 text-xs">
                <span className="font-semibold">{t.user_name}</span>
                <span className="text-zinc-500">{dateTime(t.clock_in)} → {t.clock_out ? timeOnly(t.clock_out) : <span className="font-bold text-emerald-400">active</span>}</span>
                <span className="font-bold">{hoursBetween(t.clock_in, t.clock_out)}</span>
              </div>
            ))}
            {!props.timesheets.length && <p className="text-sm text-zinc-600">No entries yet — clock in to start a timesheet.</p>}
          </div>
        </div>

        {/* shift history */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-zinc-300">Shift history</h2>
          <div className="space-y-2">
            {props.history.map((s) => (
              <div key={s.id} className="rounded-xl bg-zinc-950 p-3.5 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-bold">{s.user_name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${s.status === "open" ? "bg-amber-500/15 text-amber-400" : "bg-zinc-800 text-zinc-400"}`}>{s.status}</span>
                </div>
                <div className="mt-1 text-xs text-zinc-500">{dateTime(s.opened_at)}{s.closed_at ? ` → ${timeOnly(s.closed_at)}` : ""}</div>
                {s.status === "closed" && (
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    <div><span className="text-zinc-500">Expected</span><div className="font-bold">{money(s.expected_cash_cents)}</div></div>
                    <div><span className="text-zinc-500">Counted</span><div className="font-bold">{money(s.counted_cash_cents)}</div></div>
                    <div><span className="text-zinc-500">Variance</span>
                      <div className={`font-bold ${s.variance_cents === 0 ? "text-emerald-400" : "text-amber-400"}`}>{money(s.variance_cents)}</div>
                    </div>
                  </div>
                )}
                {s.notes && <div className="mt-1 text-[11px] italic text-zinc-500">“{s.notes}”</div>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
