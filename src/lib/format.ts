// Formatting helpers — money is always integer cents.
export function money(cents: number | null | undefined): string {
  const c = Math.round(Number(cents ?? 0));
  const neg = c < 0;
  const abs = Math.abs(c);
  const s = `$${(abs / 100).toFixed(2)}`;
  return neg ? `-${s}` : s;
}

export function num(v: string | number | null | undefined): number {
  return Number(v ?? 0);
}

export function qty(v: string | number | null | undefined): string {
  const n = Number(v ?? 0);
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(3).replace(/\.?0+$/, "");
}

export function unitCost(centsPerUnit: string | number): string {
  const n = Number(centsPerUnit);
  if (n >= 100) return money(n);
  if (n >= 1) return `${n.toFixed(2)}¢`;
  return `${n.toFixed(4)}¢`;
}

export function dateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dt = new Date(d);
  return dt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function dayLabel(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function timeOnly(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function minsAgo(d: Date | string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 60000));
}

export function hoursBetween(a: Date | string, b: Date | string | null): string {
  const start = new Date(a).getTime();
  const end = b ? new Date(b).getTime() : Date.now();
  const h = (end - start) / 3600000;
  return `${h.toFixed(1)}h`;
}
