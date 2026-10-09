import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { getSession } from "@/lib/auth";
import { ensureSeeded } from "@/db/seed";
import { Nav } from "@/components/nav";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans-var" });
const grotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-display-var" });

export const metadata: Metadata = {
  title: "Ember POS — Fire Kitchen Platform",
  description: "Full-stack restaurant POS + inventory platform: orders, kitchen display, tables, FIFO inventory, reports.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  await ensureSeeded();
  const session = await getSession();
  return (
    <html lang="en" className={`${inter.variable} ${grotesk.variable}`}>
      <body className="bg-zinc-950 text-zinc-100 antialiased">
        {session ? (
          <div className="flex h-screen overflow-hidden">
            <Nav user={session} />
            <main className="flex-1 overflow-y-auto">{children}</main>
          </div>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
