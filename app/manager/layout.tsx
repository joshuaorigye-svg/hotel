import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { BrandMark } from "@/components/brand";
import { hotel } from "@/config/hotel";
import { ThemeToggle } from "@/components/theme-toggle";

export default async function ManagerLayout({ children }: { children: React.ReactNode }) {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await db.from("profiles").select("role,departments(slug)").eq("id", user.id).single();
  if (profile?.role === "owner") redirect("/owner/dashboard");
  if (profile?.role !== "manager") redirect("/staff/tasks");
  const department = profile.departments as unknown as { slug: string } | null;

  return (
    <div className="workspace-theme min-h-screen bg-cream">
      <header className="flex items-center gap-3 border-b border-[#EAE6DC] bg-white px-5 py-3">
        <BrandMark size={48} />
        <div><p className="font-semibold text-forest">{hotel.name}</p><p className="text-xs text-gray-500">Manager workspace</p></div>
        <div className="ml-auto flex items-center gap-3"><Link href="/manager/leave" className="rounded-lg bg-forest px-3 py-2 text-sm font-semibold text-white">Leave requests</Link>{department?.slug === "human-resources" && <Link href="/manager/hr" className="rounded-lg border border-forest px-3 py-2 text-sm font-semibold text-forest">HR requests</Link>}<ThemeToggle compact /></div>
      </header>
      <main className="mx-auto max-w-6xl p-4 md:p-8">{children}</main>
    </div>
  );
}
