import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function MySchedulePage() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/login");
  const now = new Date();
  const horizon = new Date(now.getTime() + 60 * 86400000);
  const { data: shifts, error } = await db.from("staff_shift_assignments")
    .select("id,shift_name,starts_at,ends_at,status")
    .eq("staff_id",user.id).eq("status","scheduled")
    .gte("starts_at",now.toISOString()).lt("starts_at",horizon.toISOString())
    .order("starts_at").limit(40);
  const fmt = (value: string) => new Intl.DateTimeFormat("en-UG",{dateStyle:"medium",timeStyle:"short",timeZone:"Africa/Kampala"}).format(new Date(value));
  return <main className="mx-auto max-w-3xl space-y-6"><header><p className="text-xs font-bold tracking-widest text-gold">STAFF WORKSPACE</p><h1 className="mt-2 text-3xl font-semibold text-forest">My upcoming shifts</h1><p className="mt-2 text-sm text-gray-500">Your published roster for the next 60 days. All times are Africa/Kampala.</p></header>{error?<p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Your roster is not available yet. The hotel manager must apply migration 0018.</p>:!shifts?.length?<section className="rounded-2xl border border-[#EAE6DC] bg-white p-8 text-center text-sm text-gray-500">No upcoming shifts have been assigned to you.</section>:<section className="space-y-3">{shifts.map(shift=><article key={shift.id} className="rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold text-forest">{shift.shift_name}</h2><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs text-emerald-700">Scheduled</span></div><p className="mt-3 text-sm text-gray-700">{fmt(shift.starts_at)}</p><p className="mt-1 text-sm text-gray-500">Until {fmt(shift.ends_at)}</p></article>)}</section>}<p className="text-xs text-gray-400">If a shift needs to change, contact your department manager. Staff cannot edit assignments directly.</p></main>;
}
