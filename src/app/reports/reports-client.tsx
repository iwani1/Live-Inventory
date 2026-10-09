"use client";

import Link from "next/link";
import { Download, DollarSign, TrendingUp, Receipt, Percent, Banknote, CreditCard, Smartphone, UtensilsCrossed, ShoppingBag, Bike } from "lucide-react";
import { money } from "@/lib/format";
import { RevenueChart } from "@/components/revenue-chart";
import type { Summary, DayRow, MixRow, ItemRow } from "./page";
import type { FoodCostRow } from "@/lib/foodcost";

const PAY_ICON: Record<string, typeof Banknote> = { cash: Banknote, card: CreditCard, mobile: Smartphone };
const TYPE_ICON: Record<string, typeof UtensilsCrossed> = { dine_in: UtensilsCrossed, takeaway: ShoppingBag, delivery: Bike };

export function ReportsClient(props: {
  days: number; summary: Summary; series: DayRow[]; payMix: MixRow[]; typeMix: MixRow[];
  items: ItemRow[]; foodCost: FoodCostRow[]; canExport: boolean;
}) {
  const s = props.summary;
  const avgTicket = s.orders > 0 ? Math.round(s.revenue / s.orders) : 0;
  const margin = s.revenue > 0 ? ((s.revenue - s.cogs) / s.revenue) * 100 : 0;
  const payTotal = Math.max(1, props.payMix.reduce((x, m) => x + m.total, 0));
  const typeTotal = Math.max(1, props.typeMix.reduce((x, m) => x + m.total, 0));

  const exports = [
    { report: "sales", label: "Daily sales" },
    { report: "items", label: "Item performance" },
    { report: "foodcost", label: "Food cost & margin" },
    { report: "inventory", label: "Inventory valuation" },
  ];

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Reports</h1>
          <p className="mt-1 text-sm text-zinc-500">Sales, margins and cost analytics</p>
        </div>
        <div className="flex gap-2">
          {[7, 14, 30].map((d) => (
            <Link key={d} href={`/reports?range=${d}`}
              className={`rounded-full px-4 py-2 text-xs font-bold ${props.days === d ? "bg-ember-600 text-white" : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800"}`}>
              {d} days
            </Link>
          ))}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: "Revenue", value: money(s.revenue), sub: `${s.orders} orders`, Icon: DollarSign },
          { label: "Average ticket", value: money(avgTicket), sub: `${money(s.tips)} tips collected`, Icon: Receipt },
          { label: "Gross margin", value: `${margin.toFixed(1)}%`, sub: `${money(s.cogs)} FIFO COGS`, Icon: TrendingUp },
          { label: "Discounts & tax", value: money(s.discounts), sub: `${money(s.tax)} tax collected`, Icon: Percent },
        ].map(({ label, value, sub, Icon }) => (
          <div key={label} className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{label}</span>
              <Icon className="h-4 w-4 text-ember-500" />
            </div>
            <div className="font-display text-3xl font-bold tracking-tight">{value}</div>
            <div className="mt-1 text-xs text-zinc-500">{sub}</div>
          </div>
        ))}
      </div>

      {/* chart + CSV export */}
      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 xl:col-span-2">
          <h2 className="mb-4 text-sm font-semibold text-zinc-300">Daily revenue</h2>
          <RevenueChart data={props.series.map((d) => ({ day: d.day, revenue: d.revenue / 100 }))} />
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
          <h2 className="mb-4 text-sm font-semibold text-zinc-300">CSV exports</h2>
          <div className="space-y-2">
            {exports.map((e) => (
              props.canExport ? (
                <a key={e.report} href={`/api/export?report=${e.report}&range=${props.days}`}
                  className="flex items-center justify-between rounded-xl border border-zinc-800 px-4 py-3 text-sm font-semibold transition-colors hover:border-ember-500/40 hover:bg-ember-500/5">
                  {e.label}
                  <Download className="h-4 w-4 text-zinc-500" />
                </a>
              ) : (
                <div key={e.report} className="flex items-center justify-between rounded-xl border border-zinc-800/50 px-4 py-3 text-sm text-zinc-600">
                  {e.label}
                  <span className="text-[10px] font-bold uppercase">no export perm</span>
                </div>
              )
            ))}
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-zinc-600">
            Exports are streamed as CSV with cost data at FIFO valuation — ready for QuickBooks/Xero import mapping.
          </p>
        </div>
      </div>

      {/* mixes */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
          <h2 className="mb-4 text-sm font-semibold text-zinc-300">Payment methods</h2>
          <div className="space-y-3">
            {props.payMix.map((m) => {
              const Icon = PAY_ICON[m.method ?? ""] ?? Banknote;
              return (
                <div key={m.method}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 font-semibold capitalize"><Icon className="h-4 w-4 text-zinc-500" />{m.method}</span>
                    <span className="text-zinc-400">{money(m.total)} · {m.count} txn</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                    <div className="h-full rounded-full bg-gradient-to-r from-ember-600 to-ember-400" style={{ width: `${(m.total / payTotal) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
          <h2 className="mb-4 text-sm font-semibold text-zinc-300">Order channels</h2>
          <div className="space-y-3">
            {props.typeMix.map((m) => {
              const Icon = TYPE_ICON[m.type ?? ""] ?? UtensilsCrossed;
              return (
                <div key={m.type}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 font-semibold capitalize"><Icon className="h-4 w-4 text-zinc-500" />{m.type?.replace("_", "-")}</span>
                    <span className="text-zinc-400">{money(m.total)} · {m.count}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                    <div className="h-full rounded-full bg-gradient-to-r from-sky-600 to-sky-400" style={{ width: `${(m.total / typeTotal) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* item performance + food cost */}
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <div className="overflow-hidden rounded-2xl border border-zinc-800">
          <div className="border-b border-zinc-800 bg-zinc-900/60 px-5 py-3">
            <h2 className="text-sm font-semibold text-zinc-300">Item performance — top 10 by revenue</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/40 text-left text-[11px] uppercase tracking-wider text-zinc-500">
                <th className="px-5 py-2.5">Item</th><th className="px-5 py-2.5">Qty</th><th className="px-5 py-2.5 text-right">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {props.items.map((i) => (
                <tr key={i.name} className="border-b border-zinc-800/60">
                  <td className="px-5 py-2.5 font-semibold">{i.name}</td>
                  <td className="px-5 py-2.5 text-zinc-400">{i.qty}</td>
                  <td className="px-5 py-2.5 text-right font-semibold">{money(i.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="overflow-hidden rounded-2xl border border-zinc-800">
          <div className="border-b border-zinc-800 bg-zinc-900/60 px-5 py-3">
            <h2 className="text-sm font-semibold text-zinc-300">Food cost &amp; margin — theoretical, at current FIFO average costs</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/40 text-left text-[11px] uppercase tracking-wider text-zinc-500">
                <th className="px-5 py-2.5">Item</th><th className="px-5 py-2.5">Price</th><th className="px-5 py-2.5">Plate cost</th>
                <th className="px-5 py-2.5">Food cost</th><th className="px-5 py-2.5 text-right">Margin</th>
              </tr>
            </thead>
            <tbody>
              {props.foodCost.map((f) => (
                <tr key={f.id} className="border-b border-zinc-800/60">
                  <td className="px-5 py-2.5 font-semibold">
                    {f.name}
                    {f.isCombo && <span className="ml-1.5 rounded bg-zinc-800 px-1 py-0.5 text-[9px] font-bold uppercase text-zinc-400">combo</span>}
                  </td>
                  <td className="px-5 py-2.5 text-zinc-400">{money(f.priceCents)}</td>
                  <td className="px-5 py-2.5 text-zinc-400">{money(f.recipeCostCents)}</td>
                  <td className={`px-5 py-2.5 font-bold ${f.foodCostPct > 0.35 ? "text-red-400" : f.foodCostPct > 0.28 ? "text-amber-400" : "text-emerald-400"}`}>
                    {(f.foodCostPct * 100).toFixed(1)}%
                  </td>
                  <td className="px-5 py-2.5 text-right font-semibold">{money(f.marginCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
