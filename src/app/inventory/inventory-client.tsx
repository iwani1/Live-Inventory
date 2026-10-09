"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Boxes, AlertTriangle, Plus, PackagePlus, Truck, FileText, ArrowDownRight, ArrowUpRight,
  X, Pencil, CheckCircle2, Send, Ban,
} from "lucide-react";
import { money, qty, unitCost, dateTime } from "@/lib/format";
import { adjustIngredient, saveIngredient, saveSupplier, createPO, setPOStatus, receivePO } from "@/actions/inventory";

export type InvIngredient = {
  id: number; name: string; unit: string; stockQty: number; reorderLevel: number;
  avgCostCents: number; supplierName: string | null; low: boolean; valueCents: number;
};
export type InvMovement = {
  id: number; ingredientName: string; type: string; qtyDelta: number; unitCostCents: number;
  note: string | null; refType: string | null; createdAt: string; userName: string | null;
};
export type InvSupplier = {
  id: number; name: string; contact: string | null; email: string | null; phone: string | null;
  leadTimeDays: number; notes: string | null;
};
export type InvPO = {
  id: number; status: string; totalCents: number; notes: string | null;
  createdAt: string; receivedAt: string | null; supplierName: string;
  items: { ingredientId: number; name: string; qty: number; unitCostCents: number }[];
};

const UNITS = ["g", "ml", "pcs", "kg", "l"];
const MOVE_STYLE: Record<string, string> = {
  purchase: "text-emerald-400", sale: "text-red-400", adjustment: "text-sky-400",
  waste: "text-amber-400", refund_restock: "text-purple-400",
};

export function InventoryClient(props: {
  ingredients: InvIngredient[]; movements: InvMovement[]; suppliers: InvSupplier[]; purchaseOrders: InvPO[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"stock" | "ledger" | "po" | "suppliers">("stock");
  const [adjustFor, setAdjustFor] = useState<InvIngredient | null>(null);
  const [editFor, setEditFor] = useState<InvIngredient | "new" | null>(null);
  const [supplierFor, setSupplierFor] = useState<InvSupplier | "new" | null>(null);
  const [poOpen, setPoOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ error?: string }>, close?: () => void) =>
    startTransition(async () => {
      setMsg(null);
      const res = await fn();
      if (res.error) setMsg(res.error);
      else { close?.(); router.refresh(); }
    });

  const low = props.ingredients.filter((i) => i.low);
  const totalValue = props.ingredients.reduce((s, i) => s + i.valueCents, 0);

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Inventory</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {props.ingredients.length} ingredients · on-hand value <span className="font-bold text-zinc-300">{money(totalValue)}</span> (FIFO layers)
          </p>
        </div>
        {low.length > 0 && (
          <div className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm font-semibold text-amber-300">
            <AlertTriangle className="h-4 w-4" /> {low.length} below reorder point
          </div>
        )}
      </div>

      {/* low-stock strip */}
      {low.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-2">
          {low.map((l) => (
            <button key={l.id} onClick={() => setPoOpen(true)}
              className="rounded-full border border-amber-500/30 bg-amber-500/5 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/15">
              {l.name}: {qty(l.stockQty)} {l.unit} — reorder
            </button>
          ))}
        </div>
      )}

      {/* tabs */}
      <div className="mb-5 flex gap-2">
        {([["stock", "Stock levels", Boxes], ["ledger", "Stock ledger", FileText], ["po", "Purchase orders", Truck], ["suppliers", "Suppliers", PackagePlus]] as const).map(([k, label, Icon]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold ${tab === k ? "bg-ember-600 text-white" : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800"}`}>
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>
      {msg && <p className="mb-4 rounded-xl bg-red-500/10 p-3 text-sm font-semibold text-red-400">{msg}</p>}

      {/* ---------------- stock tab ---------------- */}
      {tab === "stock" && (
        <div className="overflow-x-auto rounded-2xl border border-zinc-800">
          <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/60 px-5 py-3">
            <span className="text-sm font-semibold text-zinc-300">On-hand quantities</span>
            <button onClick={() => setEditFor("new")} className="flex items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-bold hover:bg-zinc-700">
              <Plus className="h-3.5 w-3.5" /> New ingredient
            </button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/40 text-left text-[11px] uppercase tracking-wider text-zinc-500">
                <th className="px-5 py-3">Ingredient</th><th className="px-5 py-3">On hand</th>
                <th className="px-5 py-3">Reorder at</th><th className="px-5 py-3">Avg cost</th>
                <th className="px-5 py-3">Stock value</th><th className="px-5 py-3">Supplier</th><th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {props.ingredients.map((i) => (
                <tr key={i.id} className={`border-b border-zinc-800/60 ${i.low ? "bg-amber-500/[0.04]" : ""}`}>
                  <td className="px-5 py-3 font-semibold">
                    {i.name} {i.low && <AlertTriangle className="ml-1 inline h-3.5 w-3.5 text-amber-400" />}
                  </td>
                  <td className={`px-5 py-3 font-bold ${i.low ? "text-amber-400" : ""}`}>{qty(i.stockQty)} {i.unit}</td>
                  <td className="px-5 py-3 text-zinc-400">{qty(i.reorderLevel)} {i.unit}</td>
                  <td className="px-5 py-3 text-zinc-400">{unitCost(i.avgCostCents)}/{i.unit}</td>
                  <td className="px-5 py-3">{money(i.valueCents)}</td>
                  <td className="px-5 py-3 text-zinc-400">{i.supplierName ?? "—"}</td>
                  <td className="px-5 py-3">
                    <div className="flex justify-end gap-1.5">
                      <button onClick={() => setAdjustFor(i)} className="rounded-lg border border-zinc-800 px-2.5 py-1.5 text-[11px] font-bold text-zinc-300 hover:border-zinc-600">Adjust</button>
                      <button onClick={() => setEditFor(i)} className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"><Pencil className="h-3.5 w-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ---------------- ledger tab ---------------- */}
      {tab === "ledger" && (
        <div className="overflow-x-auto rounded-2xl border border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/40 text-left text-[11px] uppercase tracking-wider text-zinc-500">
                <th className="px-5 py-3">When</th><th className="px-5 py-3">Ingredient</th><th className="px-5 py-3">Type</th>
                <th className="px-5 py-3">Qty</th><th className="px-5 py-3">Unit cost</th><th className="px-5 py-3">By</th><th className="px-5 py-3">Note</th>
              </tr>
            </thead>
            <tbody>
              {props.movements.map((m) => (
                <tr key={m.id} className="border-b border-zinc-800/60">
                  <td className="px-5 py-2.5 text-xs text-zinc-500">{dateTime(m.createdAt)}</td>
                  <td className="px-5 py-2.5 font-semibold">{m.ingredientName}</td>
                  <td className={`px-5 py-2.5 text-xs font-bold uppercase ${MOVE_STYLE[m.type] ?? "text-zinc-400"}`}>{m.type.replace("_", " ")}</td>
                  <td className="px-5 py-2.5 font-mono font-bold">
                    <span className={m.qtyDelta >= 0 ? "text-emerald-400" : "text-red-400"}>
                      {m.qtyDelta >= 0 ? <ArrowUpRight className="mr-0.5 inline h-3 w-3" /> : <ArrowDownRight className="mr-0.5 inline h-3 w-3" />}
                      {qty(Math.abs(m.qtyDelta))}
                    </span>
                  </td>
                  <td className="px-5 py-2.5 text-zinc-400">{unitCost(m.unitCostCents)}</td>
                  <td className="px-5 py-2.5 text-zinc-400">{m.userName ?? "system"}</td>
                  <td className="px-5 py-2.5 text-xs text-zinc-500">{m.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ---------------- purchase orders tab ---------------- */}
      {tab === "po" && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={() => setPoOpen(true)} className="flex items-center gap-2 rounded-xl bg-ember-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-ember-500">
              <Plus className="h-4 w-4" /> New purchase order
            </button>
          </div>
          {props.purchaseOrders.map((po) => (
            <div key={po.id} className="rounded-2xl border border-zinc-800 bg-zinc-900/50">
              <div className="flex flex-wrap items-center gap-3 px-5 py-4">
                <span className="font-display text-base font-bold">PO #{po.id}</span>
                <span className="text-sm text-zinc-400">{po.supplierName}</span>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase ${
                  po.status === "received" ? "bg-emerald-500/15 text-emerald-400"
                  : po.status === "sent" ? "bg-sky-500/15 text-sky-400"
                  : po.status === "cancelled" ? "bg-zinc-700/40 text-zinc-400"
                  : "bg-amber-500/15 text-amber-400"}`}>{po.status}</span>
                <span className="text-xs text-zinc-500">{dateTime(po.createdAt)}{po.receivedAt ? ` · received ${dateTime(po.receivedAt)}` : ""}</span>
                <div className="flex-1" />
                <span className="font-display text-base font-bold">{money(po.totalCents)}</span>
                {po.status === "draft" && (
                  <button disabled={pending} onClick={() => run(() => setPOStatus(po.id, "sent"))}
                    className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-bold text-zinc-300 hover:border-zinc-500 disabled:opacity-50">
                    <Send className="h-3 w-3" /> Mark sent
                  </button>
                )}
                {(po.status === "draft" || po.status === "sent") && (
                  <>
                    <button disabled={pending} onClick={() => run(() => receivePO(po.id))}
                      className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50">
                      <CheckCircle2 className="h-3 w-3" /> Receive
                    </button>
                    <button disabled={pending} onClick={() => run(() => setPOStatus(po.id, "cancelled"))}
                      className="flex items-center gap-1.5 rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-bold text-red-300 hover:bg-red-500/10 disabled:opacity-50">
                      <Ban className="h-3 w-3" />
                    </button>
                  </>
                )}
              </div>
              <div className="border-t border-zinc-800 px-5 py-3">
                <div className="grid gap-1 text-sm sm:grid-cols-2">
                  {po.items.map((it, i) => (
                    <div key={i} className="flex justify-between pr-4 text-zinc-400">
                      <span>{it.name}</span>
                      <span>{qty(it.qty)} × {unitCost(it.unitCostCents)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
          {!props.purchaseOrders.length && <p className="py-10 text-center text-sm text-zinc-600">No purchase orders yet.</p>}
        </div>
      )}

      {/* ---------------- suppliers tab ---------------- */}
      {tab === "suppliers" && (
        <div>
          <div className="mb-4 flex justify-end">
            <button onClick={() => setSupplierFor("new")} className="flex items-center gap-2 rounded-xl bg-zinc-800 px-4 py-2.5 text-sm font-bold hover:bg-zinc-700">
              <Plus className="h-4 w-4" /> New supplier
            </button>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {props.suppliers.map((s) => (
              <div key={s.id} className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
                <div className="mb-1 flex items-center justify-between">
                  <h3 className="font-display text-base font-bold">{s.name}</h3>
                  <button onClick={() => setSupplierFor(s)} className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"><Pencil className="h-3.5 w-3.5" /></button>
                </div>
                <div className="space-y-1 text-sm text-zinc-400">
                  {s.contact && <div>Contact: {s.contact}</div>}
                  {s.email && <div>{s.email}</div>}
                  {s.phone && <div>{s.phone}</div>}
                  <div>Lead time: <span className="font-semibold text-zinc-300">{s.leadTimeDays} day{s.leadTimeDays === 1 ? "" : "s"}</span></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---------------- modals ---------------- */}
      {adjustFor && (
        <AdjustModal ingredient={adjustFor} onClose={() => setAdjustFor(null)}
          onSubmit={(delta, type, note) => run(() => adjustIngredient(adjustFor.id, delta, type, note), () => setAdjustFor(null))} />
      )}
      {editFor && (
        <IngredientModal ingredient={editFor === "new" ? null : editFor} suppliers={props.suppliers}
          onClose={() => setEditFor(null)}
          onSubmit={(v) => run(() => saveIngredient(v), () => setEditFor(null))} />
      )}
      {supplierFor && (
        <SupplierModal supplier={supplierFor === "new" ? null : supplierFor}
          onClose={() => setSupplierFor(null)}
          onSubmit={(v) => run(() => saveSupplier(v), () => setSupplierFor(null))} />
      )}
      {poOpen && (
        <PoModal ingredients={props.ingredients} suppliers={props.suppliers}
          onClose={() => setPoOpen(false)}
          onSubmit={(v) => run(async () => { const r = await createPO(v); return { error: r.error }; }, () => setPoOpen(false))} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function Shell({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-lg font-bold">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

const inputCls = "w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm outline-none focus:border-ember-500";

// ---------------------------------------------------------------------------
function AdjustModal({ ingredient, onClose, onSubmit }: {
  ingredient: InvIngredient; onClose: () => void;
  onSubmit: (delta: number, type: "adjustment" | "waste", note: string) => void;
}) {
  const [dir, setDir] = useState<"add" | "remove">("add");
  const [type, setType] = useState<"adjustment" | "waste">("adjustment");
  const [q, setQ] = useState("");
  const [note, setNote] = useState("");
  return (
    <Shell onClose={onClose} title={`Adjust ${ingredient.name}`}>
      <p className="mb-3 text-sm text-zinc-400">On hand: <span className="font-bold text-zinc-200">{qty(ingredient.stockQty)} {ingredient.unit}</span></p>
      <div className="mb-3 grid grid-cols-2 gap-2">
        {(["add", "remove"] as const).map((d) => (
          <button key={d} onClick={() => setDir(d)}
            className={`rounded-xl border py-2.5 text-sm font-bold capitalize ${dir === d ? "border-ember-500 bg-ember-500/10 text-ember-300" : "border-zinc-800 text-zinc-400"}`}>{d} stock</button>
        ))}
        {(["adjustment", "waste"] as const).map((t) => (
          <button key={t} onClick={() => setType(t)}
            className={`rounded-xl border py-2.5 text-sm font-bold capitalize ${type === t ? "border-ember-500 bg-ember-500/10 text-ember-300" : "border-zinc-800 text-zinc-400"}`}>{t}</button>
        ))}
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value.replace(/[^\d.]/g, ""))} placeholder={`Quantity in ${ingredient.unit}`} inputMode="decimal" className={inputCls} />
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (e.g. count correction, spoilage)" className={`mt-2 ${inputCls}`} />
      <button onClick={() => { const v = parseFloat(q || "0"); if (v > 0) onSubmit(dir === "add" ? v : -v, type, note); }}
        className="mt-4 w-full rounded-xl bg-ember-600 py-3 text-sm font-bold text-white hover:bg-ember-500">
        Post {type} — audit logged
      </button>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
function IngredientModal({ ingredient, suppliers, onClose, onSubmit }: {
  ingredient: InvIngredient | null; suppliers: InvSupplier[]; onClose: () => void;
  onSubmit: (v: { id?: number; name: string; unit: string; reorderLevel: number; supplierId?: number | null; avgCostCents?: number }) => void;
}) {
  const [name, setName] = useState(ingredient?.name ?? "");
  const [unit, setUnit] = useState(ingredient?.unit ?? "pcs");
  const [reorder, setReorder] = useState(String(ingredient?.reorderLevel ?? 0));
  const [supplierId, setSupplierId] = useState<string>(props0(suppliers, ingredient));
  function props0(sups: InvSupplier[], ing: InvIngredient | null) {
    const found = sups.find((s) => s.name === ing?.supplierName);
    return found ? String(found.id) : "";
  }
  const [cost, setCost] = useState("");
  return (
    <Shell onClose={onClose} title={ingredient ? `Edit ${ingredient.name}` : "New ingredient"}>
      <div className="space-y-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className={inputCls} />
        <div className="grid grid-cols-2 gap-2">
          <select value={unit} onChange={(e) => setUnit(e.target.value)} className={inputCls}>
            {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <input value={reorder} onChange={(e) => setReorder(e.target.value.replace(/[^\d.]/g, ""))} placeholder="Reorder level" inputMode="decimal" className={inputCls} />
        </div>
        <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={inputCls}>
          <option value="">No default supplier</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {!ingredient && (
          <input value={cost} onChange={(e) => setCost(e.target.value.replace(/[^\d.]/g, ""))} placeholder="Starting avg cost (cents per unit)" inputMode="decimal" className={inputCls} />
        )}
      </div>
      <button onClick={() => onSubmit({
        id: ingredient?.id, name, unit, reorderLevel: parseFloat(reorder || "0"),
        supplierId: supplierId ? Number(supplierId) : null,
        avgCostCents: cost ? parseFloat(cost) : 0,
      })} className="mt-4 w-full rounded-xl bg-ember-600 py-3 text-sm font-bold text-white hover:bg-ember-500">
        Save ingredient
      </button>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
function SupplierModal({ supplier, onClose, onSubmit }: {
  supplier: InvSupplier | null; onClose: () => void;
  onSubmit: (v: { id?: number; name: string; contact?: string; email?: string; phone?: string; leadTimeDays?: number; notes?: string }) => void;
}) {
  const [f, setF] = useState({
    name: supplier?.name ?? "", contact: supplier?.contact ?? "", email: supplier?.email ?? "",
    phone: supplier?.phone ?? "", lead: String(supplier?.leadTimeDays ?? 2), notes: supplier?.notes ?? "",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  return (
    <Shell onClose={onClose} title={supplier ? `Edit ${supplier.name}` : "New supplier"}>
      <div className="space-y-2">
        <input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Company name" className={inputCls} />
        <input value={f.contact} onChange={(e) => set("contact", e.target.value)} placeholder="Contact person" className={inputCls} />
        <div className="grid grid-cols-2 gap-2">
          <input value={f.email} onChange={(e) => set("email", e.target.value)} placeholder="Email" className={inputCls} />
          <input value={f.phone} onChange={(e) => set("phone", e.target.value)} placeholder="Phone" className={inputCls} />
        </div>
        <input value={f.lead} onChange={(e) => set("lead", e.target.value.replace(/\D/g, ""))} placeholder="Lead time (days)" inputMode="numeric" className={inputCls} />
        <input value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Notes" className={inputCls} />
      </div>
      <button onClick={() => onSubmit({
        id: supplier?.id, name: f.name, contact: f.contact, email: f.email,
        phone: f.phone, leadTimeDays: parseInt(f.lead || "2", 10), notes: f.notes,
      })} className="mt-4 w-full rounded-xl bg-ember-600 py-3 text-sm font-bold text-white hover:bg-ember-500">
        Save supplier
      </button>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
function PoModal({ ingredients, suppliers, onClose, onSubmit }: {
  ingredients: InvIngredient[]; suppliers: InvSupplier[]; onClose: () => void;
  onSubmit: (v: { supplierId: number; notes?: string; items: { ingredientId: number; qty: number; unitCostCents: number }[] }) => void;
}) {
  const [supplierId, setSupplierId] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<{ ingredientId: string; qty: string; cost: string }[]>([{ ingredientId: "", qty: "", cost: "" }]);

  const setRow = (i: number, k: string, v: string) =>
    setRows((r) => r.map((row, idx) => {
      if (idx !== i) return row;
      if (k === "ingredientId") {
        const ing = ingredients.find((x) => x.id === Number(v));
        return { ...row, ingredientId: v, cost: ing ? String(ing.avgCostCents) : row.cost };
      }
      return { ...row, [k]: v };
    }));

  const valid = rows.filter((r) => r.ingredientId && parseFloat(r.qty) > 0);
  const total = valid.reduce((s, r) => s + parseFloat(r.qty) * parseFloat(r.cost || "0"), 0);

  return (
    <Shell onClose={onClose} title="New purchase order">
      <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={`mb-3 ${inputCls}`}>
        <option value="">Select supplier…</option>
        {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex gap-2">
            <select value={r.ingredientId} onChange={(e) => setRow(i, "ingredientId", e.target.value)} className={`flex-1 ${inputCls}`}>
              <option value="">Ingredient…</option>
              {ingredients.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.unit})</option>)}
            </select>
            <input value={r.qty} onChange={(e) => setRow(i, "qty", e.target.value.replace(/[^\d.]/g, ""))} placeholder="Qty" inputMode="decimal" className={`w-24 ${inputCls}`} />
            <input value={r.cost} onChange={(e) => setRow(i, "cost", e.target.value.replace(/[^\d.]/g, ""))} placeholder="¢/unit" inputMode="decimal" className={`w-24 ${inputCls}`} />
            <button onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))} className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-800 hover:text-red-400"><X className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
      <button onClick={() => setRows((rs) => [...rs, { ingredientId: "", qty: "", cost: "" }])}
        className="mt-2 flex items-center gap-1.5 rounded-lg border border-zinc-800 px-3 py-2 text-xs font-bold text-zinc-300 hover:border-zinc-600">
        <Plus className="h-3.5 w-3.5" /> Add line
      </button>
      <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="PO notes" className={`mt-3 ${inputCls}`} />
      <div className="mt-4 flex items-center justify-between">
        <span className="text-sm text-zinc-400">PO total</span>
        <span className="font-display text-xl font-bold">{money(Math.round(total))}</span>
      </div>
      <button disabled={!supplierId || !valid.length} onClick={() => onSubmit({
        supplierId: Number(supplierId), notes,
        items: valid.map((r) => ({ ingredientId: Number(r.ingredientId), qty: parseFloat(r.qty), unitCostCents: parseFloat(r.cost || "0") })),
      })} className="mt-2 w-full rounded-xl bg-ember-600 py-3 text-sm font-bold text-white hover:bg-ember-500 disabled:opacity-40">
        Create purchase order
      </button>
    </Shell>
  );
}
