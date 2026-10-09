"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, Minus, Trash2, Users, Percent, Banknote, CreditCard, Smartphone,
  Send, ReceiptText, X, Printer, CheckCircle2, UtensilsCrossed, Bike, ShoppingBag,
  Sticker, Split, Armchair,
} from "lucide-react";
import { money } from "@/lib/format";
import { sendToKitchen, applyDiscount, applyTip, voidLine, payOrder } from "@/actions/pos";
import { splitEven } from "@/lib/checkout";

// ---------------------------------------------------------------------------
export type PosMenuItem = {
  id: number; name: string; priceCents: number; categoryId: number; color: string; isCombo: boolean;
  groups: {
    id: number; name: string; required: boolean; min: number; max: number;
    options: { id: number; name: string; priceDeltaCents: number }[];
  }[];
};
export type PosOrder = {
  id: number; orderNo: string; type: string; tableId: number | null;
  customerName: string | null; customerPhone: string | null; deliveryAddress: string | null; notes: string | null;
  subtotalCents: number; discountCents: number; taxCents: number; tipCents: number; totalCents: number;
  discountLabel: string | null; paidCents: number;
  lines: {
    id: number; name: string; qty: number; seat: number; unitPriceCents: number;
    modifiers: { name: string; priceCents: number }[]; status: string; notes: string | null;
  }[];
};
type CartLine = {
  key: string; itemId: number; name: string; qty: number; seat: number;
  baseCents: number; mods: { id: number; name: string; priceCents: number }[]; notes: string;
};

const COLOR: Record<string, string> = {
  amber: "border-amber-500/30 hover:border-amber-400 bg-amber-500/5",
  red: "border-red-500/30 hover:border-red-400 bg-red-500/5",
  orange: "border-orange-500/30 hover:border-orange-400 bg-orange-500/5",
  yellow: "border-yellow-500/30 hover:border-yellow-400 bg-yellow-500/5",
  pink: "border-pink-500/30 hover:border-pink-400 bg-pink-500/5",
  sky: "border-sky-500/30 hover:border-sky-400 bg-sky-500/5",
  zinc: "border-zinc-700 hover:border-zinc-500 bg-zinc-800/40",
};
const DOT: Record<string, string> = {
  amber: "bg-amber-500", red: "bg-red-500", orange: "bg-orange-500",
  yellow: "bg-yellow-500", pink: "bg-pink-500", sky: "bg-sky-500", zinc: "bg-zinc-500",
};
const lineCents = (l: CartLine) => (l.baseCents + l.mods.reduce((s, m) => s + m.priceCents, 0)) * l.qty;

// ---------------------------------------------------------------------------
export function PosClient(props: {
  categories: { id: number; name: string }[];
  menu: PosMenuItem[];
  tables: { id: number; name: string; seats: number }[];
  busyTableIds: number[];
  openOrders: { id: number; tableId: number | null; orderNo: string }[];
  initialOrder: PosOrder | null;
  initialTableId: number | null;
  taxRateBps: number;
  canVoid: boolean;
}) {
  const router = useRouter();
  const { menu, categories, tables, busyTableIds, openOrders, taxRateBps } = props;
  const [order, setOrder] = useState<PosOrder | null>(props.initialOrder);
  const [catId, setCatId] = useState(categories[0]?.id ?? 0);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [type, setType] = useState<"dine_in" | "takeaway" | "delivery">(
    (props.initialOrder?.type as "dine_in") ?? "dine_in",
  );
  const [tableId, setTableId] = useState<number | null>(props.initialOrder?.tableId ?? props.initialTableId ?? null);
  const [customerName, setCustomerName] = useState(props.initialOrder?.customerName ?? "");
  const [customerPhone, setCustomerPhone] = useState(props.initialOrder?.customerPhone ?? "");
  const [deliveryAddress, setDeliveryAddress] = useState(props.initialOrder?.deliveryAddress ?? "");
  const [note, setNote] = useState(props.initialOrder?.notes ?? "");

  const [modItem, setModItem] = useState<PosMenuItem | null>(null);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [stagedDiscount, setStagedDiscount] = useState<{ kind: "percent"; bps: number } | { kind: "fixed"; cents: number } | null>(null);
  const [tipOpen, setTipOpen] = useState(false);
  const [stagedTip, setStagedTip] = useState(0);
  const [payOpen, setPayOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // ------- derived totals ---------------------------------------------------
  const cartCents = cart.reduce((s, l) => s + lineCents(l), 0);
  const sentSubtotal = order?.subtotalCents ?? 0;
  const discount = order?.discountCents ?? (stagedDiscount
    ? stagedDiscount.kind === "percent"
      ? Math.round(((cartCents) * stagedDiscount.bps) / 10000)
      : Math.min(stagedDiscount.cents, cartCents)
    : 0);
  const taxable = cartCents + sentSubtotal - discount;
  const tax = order ? order.taxCents + Math.round((cartCents * taxRateBps) / 10000) : Math.round((taxable * taxRateBps) / 10000);
  const tip = order ? order.tipCents + (order.id ? 0 : stagedTip) : stagedTip;
  const total = cartCents + sentSubtotal - discount + tax + tip;
  const paid = order?.paidCents ?? 0;
  const due = (order?.totalCents ?? 0) + cartCents === 0 ? total : (order ? order.totalCents + cartCents + Math.round((cartCents * taxRateBps) / 10000) : total) - paid;

  // ------- cart ops ----------------------------------------------------------
  const tapItem = (item: PosMenuItem) => {
    if (item.groups.length) {
      // pre-select required defaults
      setModItem(item);
    } else {
      addLine(item, []);
    }
  };
  const addLine = (item: PosMenuItem, mods: { id: number; name: string; priceCents: number }[]) => {
    const modKey = mods.map((m) => m.id).sort().join(",");
    setCart((c) => {
      const existing = c.find((l) => l.itemId === item.id && l.seat === 1 && l.mods.map((m) => m.id).sort().join(",") === modKey && !l.notes);
      if (existing) return c.map((l) => (l === existing ? { ...l, qty: l.qty + 1 } : l));
      return [...c, {
        key: `${item.id}-${modKey}-${Date.now()}`, itemId: item.id, name: item.name,
        qty: 1, seat: 1, baseCents: item.priceCents, mods, notes: "",
      }];
    });
  };
  const bump = (key: string, d: number) =>
    setCart((c) => c.map((l) => (l.key === key ? { ...l, qty: Math.max(1, l.qty + d) } : l)));
  const removeLine = (key: string) => setCart((c) => c.filter((l) => l.key !== key));
  const cycleSeat = (key: string) =>
    setCart((c) => c.map((l) => (l.key === key ? { ...l, seat: (l.seat % 8) + 1 } : l)));

  // ------- server actions ----------------------------------------------------
  const refresh = () => router.refresh();

  const handleSend = () => {
    if (!cart.length && order) return;
    setNotice(null);
    startTransition(async () => {
      const res = await sendToKitchen({
        orderId: order?.id ?? null, type, tableId: type === "dine_in" ? tableId : null,
        customerName, customerPhone, deliveryAddress, notes: note,
        lines: cart.map((l) => ({ itemId: l.itemId, qty: l.qty, seat: l.seat, modifierOptionIds: l.mods.map((m) => m.id), notes: l.notes })),
      });
      if (res.error) { setNotice(res.error); return; }
      if (res.orderId) {
        if (!order?.id) {
          if (stagedDiscount) await applyDiscount(res.orderId, stagedDiscount);
          if (stagedTip) await applyTip(res.orderId, stagedTip);
          setStagedDiscount(null); setStagedTip(0);
        }
        setOrder({
          ...(order ?? {
            id: res.orderId, orderNo: res.orderNo ?? "",
            subtotalCents: 0, discountCents: 0, taxCents: 0, tipCents: 0, totalCents: 0,
            paidCents: 0, lines: [], discountLabel: null,
          }),
          id: res.orderId, orderNo: res.orderNo ?? "",
        } as PosOrder);
        setCart([]);
        refresh();
      }
    });
  };

  const setDiscount = (d: { kind: "percent"; bps: number } | { kind: "fixed"; cents: number } | null) => {
    setDiscountOpen(false);
    if (!order?.id) { setStagedDiscount(d); return; }
    startTransition(async () => { await applyDiscount(order.id, d); refresh(); });
  };
  const setTip = (cents: number) => {
    setTipOpen(false);
    if (!order?.id) { setStagedTip(cents); return; }
    startTransition(async () => { await applyTip(order.id, cents); refresh(); });
  };

  const filtered = menu.filter((m) => m.categoryId === catId);

  return (
    <div className="flex h-full flex-col lg:flex-row">
      {/* ------------------------------- menu panel ------------------------- */}
      <div className="flex-1 overflow-y-auto p-5">
        {/* order type + context bar */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {([
            { k: "dine_in", label: "Dine-in", Icon: UtensilsCrossed },
            { k: "takeaway", label: "Takeaway", Icon: ShoppingBag },
            { k: "delivery", label: "Delivery", Icon: Bike },
          ] as const).map(({ k, label, Icon }) => (
            <button key={k} onClick={() => setType(k)}
              className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors ${type === k ? "border-ember-500 bg-ember-500/10 text-ember-300" : "border-zinc-800 text-zinc-400 hover:border-zinc-700"}`}>
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
          <div className="flex-1" />
          {type === "dine_in" && (
            <select value={tableId ?? ""} onChange={(e) => setTableId(e.target.value ? Number(e.target.value) : null)}
              className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-sm font-semibold outline-none">
              <option value="">No table</option>
              {tables.map((t) => (
                <option key={t.id} value={t.id} disabled={busyTableIds.includes(t.id) && order?.tableId !== t.id}>
                  {t.name} · {t.seats} seats {busyTableIds.includes(t.id) && order?.tableId !== t.id ? "(occupied)" : ""}
                </option>
              ))}
            </select>
          )}
          {openOrders.length > 0 && (
            <select value={order?.id ?? ""} onChange={(e) => {
              const v = e.target.value;
              router.push(v ? `/pos?order=${v}` : "/pos");
            }}
              className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-sm font-semibold outline-none">
              <option value="">New ticket</option>
              {openOrders.map((o) => (
                <option key={o.id} value={o.id}>Reopen {o.orderNo}</option>
              ))}
            </select>
          )}
        </div>

        {type === "delivery" && (
          <div className="mb-4 grid gap-2 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 sm:grid-cols-3">
            <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Customer name"
              className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-ember-500" />
            <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="Phone"
              className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-ember-500" />
            <input value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} placeholder="Delivery address"
              className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-ember-500" />
          </div>
        )}

        {/* categories */}
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
          {categories.map((c) => (
            <button key={c.id} onClick={() => setCatId(c.id)}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${catId === c.id ? "bg-ember-600 text-white" : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800"}`}>
              {c.name}
            </button>
          ))}
        </div>

        {/* item grid */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {filtered.map((item) => (
            <button key={item.id} onClick={() => tapItem(item)}
              className={`group flex min-h-24 flex-col justify-between rounded-2xl border p-4 text-left transition-all active:scale-[0.98] ${COLOR[item.color] ?? COLOR.zinc}`}>
              <div>
                <div className="flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 rounded-full ${DOT[item.color] ?? DOT.zinc}`} />
                  <span className="text-sm font-semibold leading-snug">{item.name}</span>
                </div>
                {item.isCombo && <span className="mt-1 inline-block rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-400">Combo</span>}
              </div>
              <span className="mt-2 font-display text-lg font-bold">{money(item.priceCents)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ------------------------------- ticket rail ------------------------ */}
      <div className="flex w-full shrink-0 flex-col border-t border-zinc-800 bg-zinc-900/40 lg:h-full lg:w-[380px] lg:border-l lg:border-t-0">
        <div className="border-b border-zinc-800 px-5 py-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-bold">
              {order?.orderNo ? `Ticket ${order.orderNo}` : "New ticket"}
            </h2>
            {tableId && type === "dine_in" && (
              <span className="rounded-lg bg-zinc-800 px-2.5 py-1 text-xs font-bold text-zinc-300">
                {tables.find((t) => t.id === tableId)?.name}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs capitalize text-zinc-500">{type.replace("_", "-")}{paid > 0 ? ` · ${money(paid)} paid` : ""}</p>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {/* sent lines */}
          {order?.lines.map((l) => (
            <div key={l.id} className="rounded-xl border border-zinc-800/70 bg-zinc-950/60 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{l.qty}× {l.name}</div>
                  {l.modifiers.length > 0 && (
                    <div className="mt-0.5 text-xs text-zinc-500">{l.modifiers.map((m) => m.name).join(", ")}</div>
                  )}
                  <div className="mt-1 flex items-center gap-2">
                    <span className="flex items-center gap-1 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-bold text-zinc-400">
                      <Armchair className="h-3 w-3" /> S{l.seat}
                    </span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${l.status === "served" ? "bg-emerald-500/15 text-emerald-400" : l.status === "ready" ? "bg-sky-500/15 text-sky-400" : "bg-amber-500/15 text-amber-400"}`}>{l.status}</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold">{money(l.unitPriceCents * l.qty)}</div>
                  {props.canVoid && l.status !== "served" && (
                    <button onClick={() => startTransition(async () => { await voidLine(l.id); refresh(); })}
                      className="mt-1 text-[11px] font-semibold text-red-400/80 hover:text-red-300">Void</button>
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* draft lines */}
          {cart.map((l) => (
            <div key={l.key} className="rounded-xl border border-ember-500/30 bg-ember-500/5 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{l.name}</div>
                  {l.mods.length > 0 && (
                    <div className="mt-0.5 text-xs text-zinc-400">{l.mods.map((m) => `${m.name}${m.priceCents ? ` +${money(m.priceCents)}` : ""}`).join(", ")}</div>
                  )}
                  <button onClick={() => cycleSeat(l.key)} className="mt-1 flex items-center gap-1 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-bold text-zinc-400 hover:bg-zinc-700">
                    <Armchair className="h-3 w-3" /> Seat {l.seat}
                  </button>
                </div>
                <div className="text-sm font-semibold">{money(lineCents(l))}</div>
              </div>
              <div className="mt-2 flex items-center gap-1.5">
                <button onClick={() => bump(l.key, -1)} className="rounded-lg border border-zinc-700 p-1.5 hover:bg-zinc-800"><Minus className="h-3.5 w-3.5" /></button>
                <span className="w-7 text-center text-sm font-bold">{l.qty}</span>
                <button onClick={() => bump(l.key, 1)} className="rounded-lg border border-zinc-700 p-1.5 hover:bg-zinc-800"><Plus className="h-3.5 w-3.5" /></button>
                <div className="flex-1" />
                <button onClick={() => removeLine(l.key)} className="rounded-lg p-1.5 text-zinc-500 hover:bg-red-500/10 hover:text-red-400"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
          {!cart.length && !order?.lines.length && (
            <p className="py-10 text-center text-sm text-zinc-600">Tap menu items to start a ticket</p>
          )}
        </div>

        {/* totals + actions */}
        <div className="space-y-1.5 border-t border-zinc-800 p-4 text-sm">
          <div className="flex justify-between text-zinc-400"><span>Subtotal</span><span>{money(cartCents + sentSubtotal)}</span></div>
          {(discount > 0) && <div className="flex justify-between text-emerald-400"><span>Discount {order?.discountLabel?.startsWith("pct:") ? `(${Number(order.discountLabel.slice(4)) / 100}%)` : ""}</span><span>-{money(discount)}</span></div>}
          <div className="flex justify-between text-zinc-400"><span>Tax ({(taxRateBps / 100).toFixed(2)}%)</span><span>{money(order ? order.taxCents + Math.round((cartCents * taxRateBps) / 10000) : tax)}</span></div>
          {(tip > 0 || stagedTip > 0) && <div className="flex justify-between text-zinc-400"><span>Tip</span><span>{money(tip || stagedTip)}</span></div>}
          {paid > 0 && <div className="flex justify-between text-emerald-400"><span>Paid</span><span>-{money(paid)}</span></div>}
          <div className="flex items-baseline justify-between border-t border-zinc-800 pt-2">
            <span className="font-semibold">{paid > 0 ? "Balance due" : "Total"}</span>
            <span className="font-display text-2xl font-bold">{money(Math.max(0, total - paid))}</span>
          </div>

          <div className="!mt-3 grid grid-cols-2 gap-2">
            <button onClick={() => setDiscountOpen(true)} className="flex items-center justify-center gap-1.5 rounded-xl border border-zinc-800 py-2.5 text-xs font-bold text-zinc-300 hover:border-zinc-600">
              <Percent className="h-3.5 w-3.5" /> Discount
            </button>
            <button onClick={() => setTipOpen(true)} className="flex items-center justify-center gap-1.5 rounded-xl border border-zinc-800 py-2.5 text-xs font-bold text-zinc-300 hover:border-zinc-600">
              <Sticker className="h-3.5 w-3.5" /> Tip
            </button>
            <button onClick={handleSend} disabled={pending || cart.length === 0}
              className="flex items-center justify-center gap-1.5 rounded-xl bg-zinc-800 py-3 text-xs font-bold text-white hover:bg-zinc-700 disabled:opacity-40">
              <Send className="h-3.5 w-3.5" /> {order ? "Send additions" : "Fire to kitchen"}
            </button>
            <button onClick={() => {
              if (cart.length) { setNotice("Send items to the kitchen before taking payment."); return; }
              if (!order) { setNotice("Fire the ticket to the kitchen first."); return; }
              setPayOpen(true);
            }} disabled={pending || (!order && cart.length === 0)}
              className="flex items-center justify-center gap-1.5 rounded-xl bg-ember-600 py-3 text-xs font-bold text-white hover:bg-ember-500 disabled:opacity-40">
              <Banknote className="h-3.5 w-3.5" /> Pay {order ? money(Math.max(0, order.totalCents - order.paidCents)) : ""}
            </button>
          </div>
          {order && (
            <div className="grid grid-cols-2 gap-2 pt-1">
              <a href={`/receipt/${order.id}`} target="_blank" className="flex items-center justify-center gap-1.5 rounded-xl border border-zinc-800 py-2 text-xs font-bold text-zinc-400 hover:border-zinc-600">
                <Printer className="h-3.5 w-3.5" /> Receipt
              </a>
              <button onClick={() => { setOrder(null); setCart([]); router.push("/pos"); }}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-zinc-800 py-2 text-xs font-bold text-zinc-400 hover:border-zinc-600">
                <X className="h-3.5 w-3.5" /> Close ticket
              </button>
            </div>
          )}
          {notice && <p className="pt-1 text-center text-xs font-semibold text-amber-400">{notice}</p>}
        </div>
      </div>

      {/* ------------------------------- modals ----------------------------- */}
      {modItem && (
        <ModifierModal item={modItem} onClose={() => setModItem(null)}
          onAdd={(mods, noteText) => {
            const line: CartLine = {
              key: `${modItem.id}-${Date.now()}`, itemId: modItem.id, name: modItem.name, qty: 1,
              seat: 1, baseCents: modItem.priceCents, mods, notes: noteText,
            };
            setCart((c) => [...c, line]);
            setModItem(null);
          }} />
      )}

      {discountOpen && (
        <Modal onClose={() => setDiscountOpen(false)} title="Apply discount">
          <div className="grid grid-cols-3 gap-2">
            {[5, 10, 15].map((p) => (
              <button key={p} onClick={() => setDiscount({ kind: "percent", bps: p * 100 })}
                className="rounded-xl border border-zinc-800 py-4 text-lg font-bold hover:border-ember-500 hover:text-ember-300">{p}%</button>
            ))}
            {[500, 1000, 2000].map((c) => (
              <button key={c} onClick={() => setDiscount({ kind: "fixed", cents: c })}
                className="rounded-xl border border-zinc-800 py-4 text-lg font-bold hover:border-ember-500 hover:text-ember-300">{money(c)}</button>
            ))}
          </div>
          <button onClick={() => setDiscount(null)} className="mt-3 w-full rounded-xl bg-zinc-800 py-3 text-sm font-bold text-zinc-300 hover:bg-zinc-700">Remove discount</button>
          <p className="mt-3 text-center text-[11px] text-zinc-600">Every discount is written to the audit log with the operator name.</p>
        </Modal>
      )}

      {tipOpen && (
        <Modal onClose={() => setTipOpen(false)} title="Add tip">
          <div className="grid grid-cols-3 gap-2">
            {[10, 15, 20].map((p) => (
              <button key={p} onClick={() => setTip(Math.round(((order?.subtotalCents ?? cartCents) * p) / 100))}
                className="rounded-xl border border-zinc-800 py-4 text-lg font-bold hover:border-ember-500 hover:text-ember-300">{p}%</button>
            ))}
            {[200, 500, 1000].map((c) => (
              <button key={c} onClick={() => setTip(c)}
                className="rounded-xl border border-zinc-800 py-4 text-lg font-bold hover:border-ember-500 hover:text-ember-300">{money(c)}</button>
            ))}
          </div>
          <button onClick={() => setTip(0)} className="mt-3 w-full rounded-xl bg-zinc-800 py-3 text-sm font-bold text-zinc-300 hover:bg-zinc-700">No tip</button>
        </Modal>
      )}

      {payOpen && order && (
        <PayModal order={order} canVoid={props.canVoid}
          onClose={(completed) => {
            setPayOpen(false);
            if (completed) { setOrder(null); setCart([]); router.push("/pos"); }
            refresh();
          }} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function Modal({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-lg font-bold">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModifierModal({ item, onClose, onAdd }: {
  item: PosMenuItem;
  onClose: () => void;
  onAdd: (mods: { id: number; name: string; priceCents: number }[], notes: string) => void;
}) {
  const [sel, setSel] = useState<Record<number, number[]>>({});
  const [noteText, setNoteText] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const toggle = (groupId: number, optId: number, max: number) => {
    setSel((s) => {
      const cur = s[groupId] ?? [];
      if (cur.includes(optId)) return { ...s, [groupId]: cur.filter((x) => x !== optId) };
      if (cur.length >= max) return { ...s, [groupId]: [...cur.slice(1), optId] };
      return { ...s, [groupId]: [...cur, optId] };
    });
  };
  const mods = item.groups.flatMap((g) =>
    (sel[g.id] ?? []).map((id) => {
      const o = g.options.find((x) => x.id === id)!;
      return { id: o.id, name: o.name, priceCents: o.priceDeltaCents };
    }),
  );
  const extra = mods.reduce((s, m) => s + m.priceCents, 0);

  const confirm = () => {
    for (const g of item.groups) {
      const count = (sel[g.id] ?? []).length;
      if (g.required && count < g.min) { setErr(`Select ${g.name.toLowerCase()} (${g.min} required)`); return; }
    }
    onAdd(mods, noteText);
  };

  return (
    <Modal onClose={onClose} title={item.name}>
      <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1">
        {item.groups.map((g) => (
          <div key={g.id}>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold">{g.name}</span>
              <span className="text-[11px] font-medium text-zinc-500">{g.required ? "Required" : `Up to ${g.max}`}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {g.options.map((o) => {
                const active = (sel[g.id] ?? []).includes(o.id);
                return (
                  <button key={o.id} onClick={() => toggle(g.id, o.id, g.max)}
                    className={`rounded-xl border px-3 py-2.5 text-left text-sm transition-colors ${active ? "border-ember-500 bg-ember-500/10 text-ember-200" : "border-zinc-800 text-zinc-300 hover:border-zinc-600"}`}>
                    <div className="font-semibold">{o.name}</div>
                    {o.priceDeltaCents > 0 && <div className="text-xs text-zinc-500">+{money(o.priceDeltaCents)}</div>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <input value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Kitchen note (e.g. no onion)"
          className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm outline-none focus:border-ember-500" />
      </div>
      {err && <p className="mt-3 text-center text-sm font-semibold text-red-400">{err}</p>}
      <button onClick={confirm} className="mt-4 w-full rounded-xl bg-ember-600 py-3.5 text-sm font-bold text-white hover:bg-ember-500">
        Add to ticket · {money(item.priceCents + extra)}
      </button>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
function PayModal({ order, onClose, canVoid }: {
  order: PosOrder; onClose: (completed: boolean) => void; canVoid: boolean;
}) {
  const [mode, setMode] = useState<"full" | "split" | "seat">("full");
  const [splitN, setSplitN] = useState(2);
  const [method, setMethod] = useState<"cash" | "card" | "mobile">("card");
  const [tender, setTender] = useState<number>(0);
  const [done, setDone] = useState<{ change: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [paidCents, setPaidCents] = useState(order.paidCents);
  const due = Math.max(0, order.totalCents - paidCents);

  const seatShares = useMemo(() => {
    const seats = [...new Set(order.lines.map((l) => l.seat))].sort();
    const subtotal = Math.max(1, order.subtotalCents);
    return seats.map((seat) => {
      const seatSub = order.lines.filter((l) => l.seat === seat)
        .reduce((s, l) => s + l.unitPriceCents * l.qty, 0);
      const ratio = seatSub / subtotal;
      return { seat, amount: Math.round(order.totalCents * ratio) };
    }).filter((s) => s.amount > 0);
  }, [order]);

  const parts: { label: string; amount: number; seat?: number }[] =
    mode === "full" ? [{ label: "Full amount", amount: due }]
      : mode === "split"
        ? splitEven(due, splitN).map((a, i) => ({ label: `Share ${i + 1}`, amount: a }))
        : seatShares.filter((s) => true).map((s) => ({ label: `Seat ${s.seat}`, amount: s.amount, seat: s.seat }));

  const payPart = (amount: number, seat?: number) => {
    setErr(null);
    const cents = method === "cash" ? Math.min(amount, due) : Math.min(amount, due);
    startTransition(async () => {
      const res = await payOrder(order.id, [{ method, amountCents: cents, seat: seat ?? null }]);
      if (res.error) { setErr(res.error); return; }
      if (res.completed) {
        setDone({ change: method === "cash" && tender > cents ? tender - cents : res.changeCents ?? 0 });
      } else {
        setPaidCents((p) => p + cents);
      }
    });
  };

  if (done) {
    return (
      <Modal onClose={() => onClose(true)} title="Payment complete">
        <div className="py-4 text-center">
          <CheckCircle2 className="mx-auto mb-3 h-14 w-14 text-emerald-400" />
          <div className="font-display text-2xl font-bold">{order.orderNo} paid</div>
          {done.change > 0 && <div className="mt-2 text-lg font-semibold text-amber-300">Change due: {money(done.change)}</div>}
          <p className="mt-2 text-sm text-zinc-500">Stock deducted via FIFO · COGS captured on the order</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <a href={`/receipt/${order.id}`} target="_blank"
            className="flex items-center justify-center gap-2 rounded-xl border border-zinc-700 py-3 text-sm font-bold text-zinc-200 hover:bg-zinc-800">
            <Printer className="h-4 w-4" /> Print receipt
          </a>
          <button onClick={() => onClose(true)} className="rounded-xl bg-ember-600 py-3 text-sm font-bold text-white hover:bg-ember-500">
            New ticket
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={() => onClose(false)} title={`Take payment · ${order.orderNo}`}>
      {/* split mode tabs */}
      <div className="mb-3 flex gap-2">
        <button onClick={() => setMode("full")} className={`flex-1 rounded-xl border py-2.5 text-xs font-bold ${mode === "full" ? "border-ember-500 bg-ember-500/10 text-ember-300" : "border-zinc-800 text-zinc-400"}`}>Full</button>
        <button onClick={() => setMode("split")} className={`flex-1 rounded-xl border py-2.5 text-xs font-bold ${mode === "split" ? "border-ember-500 bg-ember-500/10 text-ember-300" : "border-zinc-800 text-zinc-400"}`}><Split className="mr-1 inline h-3.5 w-3.5" />Split even</button>
        <button onClick={() => setMode("seat")} className={`flex-1 rounded-xl border py-2.5 text-xs font-bold ${mode === "seat" ? "border-ember-500 bg-ember-500/10 text-ember-300" : "border-zinc-800 text-zinc-400"}`}><Users className="mr-1 inline h-3.5 w-3.5" />By seat</button>
      </div>
      {mode === "split" && (
        <div className="mb-3 flex items-center justify-center gap-2">
          {[2, 3, 4, 5, 6].map((n) => (
            <button key={n} onClick={() => setSplitN(n)}
              className={`h-9 w-9 rounded-full border text-sm font-bold ${splitN === n ? "border-ember-500 bg-ember-500/10 text-ember-300" : "border-zinc-800 text-zinc-400"}`}>{n}</button>
          ))}
        </div>
      )}

      {/* method */}
      <div className="mb-3 grid grid-cols-3 gap-2">
        {([{ k: "cash", l: "Cash", Icon: Banknote }, { k: "card", l: "Card", Icon: CreditCard }, { k: "mobile", l: "Mobile", Icon: Smartphone }] as const).map(({ k, l, Icon }) => (
          <button key={k} onClick={() => setMethod(k)}
            className={`flex items-center justify-center gap-1.5 rounded-xl border py-3 text-sm font-bold ${method === k ? "border-ember-500 bg-ember-500/10 text-ember-300" : "border-zinc-800 text-zinc-400"}`}>
            <Icon className="h-4 w-4" /> {l}
          </button>
        ))}
      </div>

      {method === "cash" && (
        <div className="mb-3">
          <div className="mb-1.5 text-xs font-semibold text-zinc-500">Cash tendered</div>
          <div className="grid grid-cols-4 gap-2">
            {[due, 1000, 2000, 5000].map((v, i) => (
              <button key={i} onClick={() => setTender(v)}
                className={`rounded-lg border py-2 text-xs font-bold ${tender === v ? "border-ember-500 text-ember-300" : "border-zinc-800 text-zinc-300"}`}>
                {i === 0 ? "Exact" : money(v)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        {parts.map((p, i) => (
          <button key={i} onClick={() => payPart(p.amount, p.seat)} disabled={pending || due <= 0}
            className="flex w-full items-center justify-between rounded-xl border border-zinc-800 px-4 py-3.5 text-sm font-bold transition-colors hover:border-ember-500 hover:bg-ember-500/5 disabled:opacity-40">
            <span className="flex items-center gap-2 text-zinc-300"><ReceiptText className="h-4 w-4 text-zinc-500" />{p.label}</span>
            <span className="font-display text-base">{money(p.amount)}</span>
          </button>
        ))}
      </div>
      {method === "cash" && tender > due && due > 0 && (
        <p className="mt-3 text-center text-sm font-semibold text-amber-300">Change: {money(tender - due)}</p>
      )}
      {err && <p className="mt-3 text-center text-sm font-semibold text-red-400">{err}</p>}
      <p className="mt-4 text-center text-xs text-zinc-500">
        Balance due: <span className="font-bold text-zinc-200">{money(due)}</span>
      </p>
      <p className="mt-2 text-center text-[11px] text-zinc-600">Card payments are simulated here — wire Stripe Terminal / Authorize.Net per the Blueprint page.</p>
    </Modal>
  );
}
