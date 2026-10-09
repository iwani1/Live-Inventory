"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Printer } from "lucide-react";

export function Autoprint() {
  const params = useSearchParams();
  useEffect(() => {
    if (params.get("print") === "1") {
      const t = setTimeout(() => window.print(), 600);
      return () => clearTimeout(t);
    }
  }, [params]);
  return null;
}

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="no-print flex items-center gap-2 rounded-xl bg-ember-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-ember-500"
    >
      <Printer className="h-4 w-4" /> Print
    </button>
  );
}
