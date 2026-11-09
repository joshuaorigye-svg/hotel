import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ShiftRoster } from "@/components/shift-roster";

export const dynamic = "force-dynamic";

export default async function ManagerSchedulePage() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await db.from("profiles").select("role,department_id,departments(name)").eq("id",user.id).single();
  if (profile?.role !== "manager" || !profile.department_id) redirect("/manager/dashboard");

  const now = new Date();
  const horizon = new Date(now.getTime() + 30 * 86400000);
  const [staffResult, shiftsResult] = await Promise.all([
    db.from("profiles").select("id,full_name,department_id").eq("department_id",profile.department_id).eq("is_active",true).in("role",["staff","manager"]).order("full_name"),
    db.from("staff_shift_assignments").select("id,staff_id,department_id,shift_name,starts_at,ends_at,status,cancellation_reason").gte("starts_at",now.toISOString()).lt("starts_at",horizon.toISOString()).order("starts_at"),
  ]);
  const departmentName = (profile.departments as any)?.name || "Your department";
  const staff = (staffResult.data || []).map(person => ({...person,department_name:departmentName}));
  const names = new Map(staff.map(person => [person.id,person.full_name]));
  const shifts = (shiftsResult.data || []).map(row => ({...row,staff_name:names.get(row.staff_id)||"Employee",department_name:departmentName}));
  return <main className="space-y-6"><header><p className="text-xs font-bold tracking-widest text-gold">MANAGER WORKSPACE</p><h1 className="mt-2 text-3xl font-semibold text-forest">Department shift roster</h1><p className="mt-2 text-sm text-gray-500">Plan and review shifts for {departmentName}.</p></header>{staffResult.error||shiftsResult.error?<p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Roster data could not be loaded. Review and apply migration 0018 before using shift scheduling.</p>:<ShiftRoster staff={staff as any} departments={[{id:profile.department_id,name:departmentName}]} shifts={shifts as any} managerDepartmentId={profile.department_id}/>}</main>;
}
