import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LeaveManagement } from "@/components/leave-management";

export const dynamic = "force-dynamic";

export default async function MyLeavePage() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { data, error } = await db.from("staff_leave")
    .select("id,staff_id,department_id,starts_on,ends_on,leave_type,reason,contact_phone,status,reviewed_at,decision_note,created_at")
    .eq("staff_id", user.id).order("created_at", { ascending: false });
  return (
    <main className="space-y-6">
      <header><p className="text-xs font-bold tracking-widest text-gold">STAFF WORKSPACE</p><h1 className="mt-2 text-3xl font-semibold text-forest">My leave</h1><p className="mt-2 text-sm text-gray-500">Request time off and follow your manager&apos;s decision.</p></header>
      {error ? <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Leave records are unavailable. Confirm migration 0017 has been reviewed and applied.</p> : <LeaveManagement mode="staff" requests={(data || []) as any} />}
    </main>
  );
}
