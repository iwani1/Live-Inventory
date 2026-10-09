// Checkout math — single source of truth for order totals.
export type DiscountInput =
  | { kind: "percent"; bps: number; label: string }
  | { kind: "fixed"; cents: number; label: string }
  | null;

export type TotalsLine = { priceCents: number; qty: number; taxExempt: boolean };

export function computeTotals(
  lines: TotalsLine[],
  discount: DiscountInput,
  tipCents: number,
  taxRateBps: number,
) {
  const subtotal = lines.reduce((s, l) => s + l.priceCents * l.qty, 0);
  let discountCents = 0;
  if (discount?.kind === "percent") discountCents = Math.round((subtotal * discount.bps) / 10000);
  if (discount?.kind === "fixed") discountCents = Math.min(discount.cents, subtotal);

  const taxableBase = lines
    .filter((l) => !l.taxExempt)
    .reduce((s, l) => s + l.priceCents * l.qty, 0);
  const discountOnTaxable =
    subtotal > 0 ? Math.round(discountCents * (taxableBase / subtotal)) : 0;
  const tax = Math.round(((taxableBase - discountOnTaxable) * taxRateBps) / 10000);

  const total = subtotal - discountCents + tax + tipCents;
  return { subtotal, discountCents, tax, tip: tipCents, total };
}

/** Split an order's totals evenly across N guests (last share absorbs rounding). */
export function splitEven(totalCents: number, n: number): number[] {
  const base = Math.floor(totalCents / n);
  const shares = Array.from({ length: n }, () => base);
  shares[n - 1] += totalCents - base * n;
  return shares;
}
