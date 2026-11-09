import {redirect} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
import {MaintenanceWorkspace} from "@/components/maintenance-workspace";
export const dynamic="force-dynamic";
export default async function OwnerIncidentsPage(){
 const db=await createClient();const {data:{user}}=await db.auth.getUser();if(!user)redirect("/login");
 const {data:profile}=await db.from("profiles").select("role").eq("id",user.id).single();if(profile?.role!=="owner")redirect("/staff/tasks");
 const [incidentResult,peopleResult,departmentResult]=await Promise.all([
  db.from("maintenance_incidents").select("*").order("reported_at",{ascending:false}).limit(500),
  db.from("profiles").select("id,full_name").eq("is_active",true).order("full_name"),
  db.from("departments").select("id,name")
 ]);
 const people=peopleResult.data||[];const names=new Map(people.map(p=>[p.id,p.full_name||"Employee"]));const departments=new Map((departmentResult.data||[]).map(d=>[d.id,d.name]));
 const incidents=(incidentResult.data||[]).map(i=>({...i,reported_name:names.get(i.reported_by)||"Employee",assignee_name:i.assigned_to?names.get(i.assigned_to)||"Employee":null,department_name:departments.get(i.department_id)||"Department"}));
 return <main className="space-y-6"><header><p className="text-xs font-bold tracking-widest text-gold">OWNER OFFICE</p><h1 className="mt-2 text-3xl font-semibold text-forest">Hotel maintenance & incidents</h1><p className="mt-2 text-sm text-gray-500">Oversee all departments, assignments, repair progress and recorded costs.</p></header>{incidentResult.error?<p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Maintenance register unavailable. Apply migration 0021.</p>:<MaintenanceWorkspace role="owner" userId={user.id} incidents={incidents as any} people={people}/>}</main>;
}