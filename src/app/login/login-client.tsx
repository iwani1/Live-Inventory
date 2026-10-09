"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Flame, Delete, LockKeyhole } from "lucide-react";
import { loginWithPin } from "@/actions/auth";
import { ROLE_LABELS } from "@/lib/perms";

export function LoginClient({ staff }: { staff: { id: number; name: string; role: string }[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<number | null>(staff[0]?.id ?? null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (pinValue: string) => {
    if (!selected || pinValue.length < 4) return;
    setError(null);
    startTransition(async () => {
      const res = await loginWithPin(selected, pinValue);
      if (res.error) {
        setError(res.error);
        setPin("");
      } else {
        router.push(res.home ?? "/");
        router.refresh();
      }
    });
  };

  const press = (d: string) => {
    setError(null);
    const next = (pin + d).slice(0, 6);
    setPin(next);
    if (next.length === 4) submit(next);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-6">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-ember-600/10 blur-3xl" />
      </div>
      <div className="relative w-full max-w-4xl">
        <div className="mb-8 flex items-center justify-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-ember-500 to-ember-700 shadow-lg shadow-ember-600/30">
            <Flame className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight">Ember &amp; Ivy</h1>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">Point of Sale</p>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {/* staff picker */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
            <h2 className="mb-4 text-sm font-semibold text-zinc-300">Who&rsquo;s on shift?</h2>
            <div className="grid grid-cols-2 gap-2">
              {staff.map((s) => (
                <button
                  key={s.id}
                  onClick={() => { setSelected(s.id); setPin(""); setError(null); }}
                  className={`rounded-xl border p-3 text-left transition-all ${
                    selected === s.id
                      ? "border-ember-500 bg-ember-500/10"
                      : "border-zinc-800 bg-zinc-900 hover:border-zinc-700"
                  }`}
                >
                  <div className="mb-1.5 flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800 text-xs font-bold text-ember-400">
                    {s.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
                  </div>
                  <div className="truncate text-sm font-semibold">{s.name}</div>
                  <div className="text-[11px] text-zinc-500">{ROLE_LABELS[s.role] ?? s.role}</div>
                </button>
              ))}
            </div>
          </div>

          {/* PIN pad */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-300">
                <LockKeyhole className="h-4 w-4 text-zinc-500" /> Enter PIN
              </h2>
              <div className="flex gap-1.5">
                {Array.from({ length: Math.max(pin.length, 4) }).map((_, i) => (
                  <div key={i} className={`h-2.5 w-2.5 rounded-full ${i < pin.length ? "bg-ember-500" : "bg-zinc-700"}`} />
                ))}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {["1","2","3","4","5","6","7","8","9"].map((d) => (
                <button key={d} onClick={() => press(d)} disabled={pending}
                  className="rounded-xl border border-zinc-800 bg-zinc-900 py-4 text-xl font-semibold transition-colors hover:border-zinc-700 hover:bg-zinc-800 disabled:opacity-50">
                  {d}
                </button>
              ))}
              <button onClick={() => setPin("")} disabled={pending}
                className="rounded-xl border border-zinc-800 bg-zinc-900 py-4 text-sm font-semibold text-zinc-400 hover:bg-zinc-800">
                Clear
              </button>
              <button onClick={() => press("0")} disabled={pending}
                className="rounded-xl border border-zinc-800 bg-zinc-900 py-4 text-xl font-semibold hover:bg-zinc-800">
                0
              </button>
              <button onClick={() => setPin(pin.slice(0, -1))} disabled={pending}
                className="rounded-xl border border-zinc-800 bg-zinc-900 py-4 text-zinc-400 hover:bg-zinc-800">
                <Delete className="mx-auto h-5 w-5" />
              </button>
            </div>
            {pin.length > 4 && (
              <button onClick={() => submit(pin)} disabled={pending}
                className="mt-3 w-full rounded-xl bg-ember-600 py-3 text-sm font-bold text-white hover:bg-ember-500 disabled:opacity-50">
                {pending ? "Signing in…" : "Sign in"}
              </button>
            )}
            {error && <p className="mt-3 text-center text-sm font-medium text-red-400">{error}</p>}
            <p className="mt-4 text-center text-[11px] text-zinc-600">
              Demo PINs — Admin 0000 · Manager 1111 · Cashier 2222 · Cook 3333 · Accountant 4444
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
