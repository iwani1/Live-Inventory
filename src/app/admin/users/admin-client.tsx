"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Pencil, ShieldCheck, Power, ScrollText, X } from "lucide-react";
import { dateTime } from "@/lib/format";
import { ROLE_LABELS, ROLES } from "@/lib/perms";
import { saveUser, toggleUserActive } from "@/actions/admin";

export type AdminUser = {
  id: number; name: string; role: string; active: boolean; created_at: string; actions: number;
};
export type AuditRow = {
  id: number; user_name: string | null; action: string; entity: string;
  entity_id: string | null; meta: Record<string, unknown> | null; created_at: string;
};

const ROLE_STYLE: Record<string, string> = {
  admin: "bg-ember-500/15 text-ember-300",
  manager: "bg-sky-500/15 text-sky-300",
  cashier: "bg-emerald-500/15 text-emerald-300",
  cook: "bg-amber-500/15 text-amber-300",
  accountant: "bg-purple-500/15 text-purple-300",
};

export function AdminClient({ users, audit, currentUserId }: {
  users: AdminUser[]; audit: AuditRow[]; currentUserId: number;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"users" | "audit">("users");
  const [editFor, setEditFor] = useState<AdminUser | "new" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ error?: string }>, close?: () => void) =>
    startTransition(async () => {
      setMsg(null);
      const res = await fn();
      if (res.error) setMsg(res.error);
      else { close?.(); router.refresh(); }
    });

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Team &amp; audit</h1>
          <p className="mt-1 text-sm text-zinc-500">Role-based access control and the immutable event trail</p>
        </div>
        <button onClick={() => setEditFor("new")}
          className="flex items-center gap-2 rounded-xl bg-ember-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-ember-500">
          <UserPlus className="h-4 w-4" /> Add staff member
        </button>
      </div>

      <div className="mb-5 flex gap-2">
        {([["users", "Staff & roles", ShieldCheck], ["audit", "Audit log", ScrollText]] as const).map(([k, label, Icon]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold ${tab === k ? "bg-ember-600 text-white" : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800"}`}>
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>
      {msg && <p className="mb-4 rounded-xl bg-red-500/10 p-3 text-sm font-semibold text-red-400">{msg}</p>}

      {tab === "users" && (
        <div className="overflow-hidden rounded-2xl border border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/40 text-left text-[11px] uppercase tracking-wider text-zinc-500">
                <th className="px-5 py-3">Name</th><th className="px-5 py-3">Role</th>
                <th className="px-5 py-3">Logged actions</th><th className="px-5 py-3">Status</th><th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-zinc-800/60">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800 text-xs font-bold text-ember-400">
                        {u.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
                      </span>
                      <span className="font-semibold">{u.name}{u.id === currentUserId && <span className="ml-2 text-xs text-zinc-500">(you)</span>}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${ROLE_STYLE[u.role]}`}>{ROLE_LABELS[u.role] ?? u.role}</span>
                  </td>
                  <td className="px-5 py-3 text-zinc-400">{u.actions}</td>
                  <td className="px-5 py-3">
                    <span className={`text-xs font-bold ${u.active ? "text-emerald-400" : "text-zinc-500"}`}>{u.active ? "Active" : "Disabled"}</span>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex justify-end gap-1.5">
                      <button onClick={() => setEditFor(u)} className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      {u.id !== currentUserId && (
                        <button disabled={pending} onClick={() => run(() => toggleUserActive(u.id))}
                          className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-red-400 disabled:opacity-40">
                          <Power className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "audit" && (
        <div className="overflow-hidden rounded-2xl border border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/40 text-left text-[11px] uppercase tracking-wider text-zinc-500">
                <th className="px-5 py-3">When</th><th className="px-5 py-3">User</th><th className="px-5 py-3">Action</th>
                <th className="px-5 py-3">Entity</th><th className="px-5 py-3">Details</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((a) => (
                <tr key={a.id} className="border-b border-zinc-800/60">
                  <td className="px-5 py-2.5 text-xs text-zinc-500">{dateTime(a.created_at)}</td>
                  <td className="px-5 py-2.5 font-semibold">{a.user_name ?? "system"}</td>
                  <td className="px-5 py-2.5">
                    <span className={`rounded px-1.5 py-0.5 font-mono text-xs ${
                      a.action.includes("refund") || a.action.includes("void") ? "bg-red-500/10 text-red-300"
                      : a.action.includes("payment") ? "bg-emerald-500/10 text-emerald-300"
                      : "bg-zinc-800 text-zinc-300"}`}>{a.action}</span>
                  </td>
                  <td className="px-5 py-2.5 text-zinc-400">{a.entity}{a.entity_id ? ` #${a.entity_id}` : ""}</td>
                  <td className="max-w-64 truncate px-5 py-2.5 font-mono text-xs text-zinc-500">
                    {a.meta ? JSON.stringify(a.meta) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editFor && (
        <UserModal user={editFor === "new" ? null : editFor} onClose={() => setEditFor(null)}
          onSubmit={(v) => run(() => saveUser(v), () => setEditFor(null))} />
      )}
    </div>
  );
}

function UserModal({ user, onClose, onSubmit }: {
  user: AdminUser | null; onClose: () => void;
  onSubmit: (v: { id?: number; name: string; role: string; pin?: string }) => void;
}) {
  const [name, setName] = useState(user?.name ?? "");
  const [role, setRole] = useState(user?.role ?? "cashier");
  const [pin, setPin] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-lg font-bold">{user ? `Edit ${user.name}` : "Add staff member"}</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name"
            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm outline-none focus:border-ember-500" />
          <select value={role} onChange={(e) => setRole(e.target.value)}
            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm outline-none focus:border-ember-500">
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
          <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric"
            placeholder={user ? "New PIN (leave blank to keep current)" : "PIN (4–6 digits)"}
            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm outline-none focus:border-ember-500" />
        </div>
        <button onClick={() => onSubmit({ id: user?.id, name, role, pin: pin || undefined })}
          className="mt-4 w-full rounded-xl bg-ember-600 py-3 text-sm font-bold text-white hover:bg-ember-500">
          Save
        </button>
        <p className="mt-3 text-center text-[11px] text-zinc-600">PINs are stored as salted SHA-256 hashes. Role changes take effect on next sign-in.</p>
      </div>
    </div>
  );
}
