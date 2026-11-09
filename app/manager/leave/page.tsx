import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LeaveManagement } from "@/components/leave-management";

export const dynamic = "force-dynamic";

export default async function ManagerLeavePage() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await db.from("profiles").select("role,departments(slug)").eq("id", user.id).single();
  if (profile?.role !== "manager") redirect("/manager/dashboard");
  const department = profile?.departments as unknown as { slug: string } | null;
  const [leaveResult, directoryResult, departmentsResult] = await Promise.all([
    db.from("staff_leave").select("id,staff_id,department_id,starts_on,ends_on,leave_type,reason,contact_phone,status,reviewed_at,decision_note,created_at").order("created_at", { ascending: false }).limit(200),
    department?.slug === "human-resources" ? db.rpc("hr_staff_directory") : db.from("profiles").select("id,full_name"),
    db.from("departments").select("id,name"),
  ]);
  const names = new Map((directoryResult.data || []).map((item: any) => [item.staff_id || item.id,item.full_name]));
  const departmentByStaff = new Map((directoryResult.data || []).filter((item: any) => item.department_name).map((item: any) => [item.staff_id,item.department_name]));
  const departments = new Map((departmentsResult.data || []).map((item: any) => [item.id,item.name]));
  const requests = (leaveResult.data || []).map((item: any) => ({ ...item, staff_name: names.get(item.staff_id) || "Employee", department_name: departments.get(item.department_id) || departmentByStaff.get(item.staff_id) || "Department" }));
  const failed = !!(leaveResult.error || directoryResult.error || departmentsResult.error);
  return (
    <main className="space-y-6">
      <header><p className="text-xs font-bold tracking-widest text-gold">MANAGER WORKSPACE</p><h1 className="mt-2 text-3xl font-semibold text-forest">Department leave requests</h1><p className="mt-2 text-sm text-gray-500">Review leave requests for your department. HR managers can see the hotel-wide register.</p></header>
      {failed ? <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Leave data could not be loaded. Confirm migration 0017 has been reviewed and applied.</p> : <LeaveManagement mode="review" requests={requests as any} />}
    </main>
  );
}
