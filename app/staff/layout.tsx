import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { BrandMark } from "@/components/brand";
import { hotel } from "@/config/hotel";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await db.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role === "owner") redirect("/owner/dashboard");
  if (profile?.role === "manager") redirect("/manager/dashboard");

  return (
    <div className="min-h-screen bg-cream">
      <header className="flex items-center gap-3 border-b border-[#EAE6DC] bg-white px-5 py-3">
        <BrandMark size={48} />
        <div className="min-w-0"><p className="font-semibold text-forest">{hotel.name}</p><p className="text-xs text-gray-500">Staff workspace</p></div>
        <nav className="ml-auto flex items-center gap-4 text-sm"><Link href="/staff/tasks" className="text-gray-600 hover:text-forest">My tasks</Link><Link href="/staff/payroll" className="font-semibold text-forest hover:underline">My payslips</Link></nav>
      </header>
      <main className="mx-auto max-w-5xl p-4 py-8 md:p-8">{children}</main>
    </div>
  );
}
