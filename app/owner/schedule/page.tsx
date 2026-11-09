import { createClient } from "@/lib/supabase/server";
import { ShiftRoster } from "@/components/shift-roster";

export const dynamic = "force-dynamic";

export default async function OwnerSchedulePage() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return null;
  const { data: profile } = await db.from("profiles").select("role").eq("id",user.id).single();
  if (profile?.role !== "owner") return null;

  const now = new Date();
  const horizon = new Date(now.getTime() + 30 * 86400000);
  const [staffResult, departmentsResult, shiftsResult] = await Promise.all([
    db.from("profiles").select("id,full_name,department_id").eq("is_active",true).in("role",["staff","manager"]).order("full_name"),
    db.from("departments").select("id,name").order("name"),
    db.from("staff_shift_assignments").select("id,staff_id,department_id,shift_name,starts_at,ends_at,status,cancellation_reason").gte("starts_at",now.toISOString()).lt("starts_at",horizon.toISOString()).order("starts_at"),
  ]);
  const departments = departmentsResult.data || [];
  const departmentNames = new Map(departments.map(item => [item.id,item.name]));
  const staff = (staffResult.data || []).map(person => ({...person,department_name:departmentNames.get(person.department_id)||"Department"}));
  const names = new Map(staff.map(person => [person.id,person.full_name]));
  const shifts = (shiftsResult.data || []).map(row => ({...row,staff_name:names.get(row.staff_id)||"Employee",department_name:departmentNames.get(row.department_id)||"Department"}));
  return <main className="space-y-6"><header><p className="text-xs font-bold tracking-widest text-gold">OWNER OFFICE</p><h1 className="mt-2 text-3xl font-semibold text-forest">Hotel-wide shift roster</h1><p className="mt-2 text-sm text-gray-500">Schedule employees across departments and review upcoming coverage.</p></header>{staffResult.error||departmentsResult.error||shiftsResult.error?<p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Roster data could not be loaded. Review and apply migration 0018 before using shift scheduling.</p>:<ShiftRoster staff={staff as any} departments={departments} shifts={shifts as any}/>}</main>;
}
