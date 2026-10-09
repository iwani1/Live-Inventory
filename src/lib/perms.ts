// Role-based permission matrix.
export const ROLES = ["admin", "manager", "cashier", "cook", "accountant"] as const;
export type Role = (typeof ROLES)[number];

export type Perm =
  | "dashboard" | "pos" | "tables" | "kitchen" | "orders" | "refund" | "void"
  | "inventory" | "reports" | "shifts" | "team" | "export" | "spec";

const MATRIX: Record<Role, Perm[]> = {
  admin: ["dashboard", "pos", "tables", "kitchen", "orders", "refund", "void", "inventory", "reports", "shifts", "team", "export", "spec"],
  manager: ["dashboard", "pos", "tables", "kitchen", "orders", "refund", "void", "inventory", "reports", "shifts", "export", "spec"],
  cashier: ["dashboard", "pos", "tables", "orders", "shifts", "spec"],
  cook: ["kitchen", "spec"],
  accountant: ["dashboard", "reports", "inventory", "shifts", "export", "spec"],
};

export function can(role: string | undefined, perm: Perm): boolean {
  if (!role) return false;
  return (MATRIX[role as Role] ?? []).includes(perm);
}

export function homeFor(role: string | undefined): string {
  switch (role) {
    case "cook": return "/kitchen";
    case "accountant": return "/reports";
    default: return "/";
  }
}

export const ROLE_LABELS: Record<string, string> = {
  admin: "Administrator",
  manager: "Manager",
  cashier: "Cashier",
  cook: "Kitchen",
  accountant: "Accountant",
};
