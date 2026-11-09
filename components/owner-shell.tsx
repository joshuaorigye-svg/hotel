"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, Users, CalendarDays, ChartNoAxesCombined, Wallet, ClipboardList, LogOut, Menu, X, PlugZap, Receipt, Banknote } from "lucide-react";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { hotel } from "@/config/hotel";
import { BrandMark } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";

const links = [
  ["/owner/dashboard", "Overview", LayoutDashboard],
  ["/owner/bookings", "Bookings", CalendarDays],
  ["/owner/checkout", "Guest checkout", Receipt],
  ["/owner/staff", "Staff & teams", Users],
  ["/owner/reports", "Reports", ChartNoAxesCombined],
  ["/owner/finance", "Finance", Wallet],
  ["/owner/finance/daily", "Daily reconciliation", Receipt],
  ["/owner/finance/performance", "Financial performance", ChartNoAxesCombined],
  ["/owner/payroll", "Staff payroll", Banknote],
  ["/owner/leave", "Leave oversight", CalendarDays],
  ["/owner/attendance", "Attendance", CalendarDays],
  ["/owner/audit", "Activity log", ClipboardList],
  ["/owner/integrations", "Integrations", PlugZap],
] as const;

export function OwnerShell({ children, ownerName }: { children: React.ReactNode; ownerName: string }) {
  const path = usePathname(), router = useRouter(), [open, setOpen] = useState(false);
  async function signOut() { await createClient().auth.signOut(); router.replace("/login"); router.refresh(); }

  return (
    <div className="workspace-theme min-h-screen bg-cream md:flex">
      {open && <button aria-label="Close menu" onClick={() => setOpen(false)} className="fixed inset-0 z-30 bg-black/40 md:hidden" />}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[260px] flex-col bg-forest text-white transition-transform md:static md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex min-h-20 items-center gap-3 border-b border-white/10 px-5">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white"><BrandMark size={44} /></div>
          <div className="min-w-0"><p className="text-sm font-semibold leading-tight">{hotel.shortName}</p><p className="mt-1 text-[10px] tracking-widest text-white/50">HOTEL MANAGEMENT</p></div>
          <button aria-label="Close navigation" className="ml-auto md:hidden" onClick={() => setOpen(false)}><X /></button>
        </div>
        <div className="px-5 pt-7"><p className="mb-3 px-3 text-[10px] font-bold tracking-widest text-white/40">OWNER OFFICE</p>
          <nav className="space-y-1">{links.map(([href, label, Icon]) => <Link key={href} href={href} onClick={() => setOpen(false)} className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm ${path === href ? "bg-white font-semibold text-forest" : "text-white/70 hover:bg-white/10"}`}><Icon size={18} />{label}</Link>)}</nav>
        </div>
        <div className="mt-auto border-t border-white/10 p-5"><div className="mb-4 rounded-xl bg-white/10 p-3"><p className="text-xs text-white/50">Signed in as</p><p className="mt-1 text-sm font-semibold">{ownerName}</p><p className="mt-1 text-xs text-gold">Owner / Super Admin</p></div>
          <button onClick={signOut} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-white/70 hover:bg-white/10"><LogOut size={18} />Sign out</button>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-[#E9E5DA] bg-white/90 px-4 backdrop-blur md:px-8">
          <div className="flex items-center gap-3"><button aria-label="Open navigation" className="rounded-lg p-2 hover:bg-gray-100 md:hidden" onClick={() => setOpen(true)}><Menu /></button><div><p className="text-xs text-gray-400">{hotel.shortName} / Owner</p><p className="text-sm font-semibold text-forest">Management workspace</p></div></div>
          <div className="flex items-center gap-2"><span className="hidden items-center gap-2 rounded-full bg-[#F4F1E8] px-3 py-2 text-xs text-gray-600 sm:flex"><i className="h-2 w-2 rounded-full bg-emerald-500" />Secure workspace</span><ThemeToggle compact /></div>
        </header>
        <div className="mx-auto max-w-[1440px] p-4 md:p-8">{children}</div>
      </main>
    </div>
  );
}
