import {redirect} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
import {MaintenanceWorkspace} from "@/components/maintenance-workspace";
export const dynamic="force-dynamic";
export default async function ManagerIncidentsPage(){
 const db=await createClient();const {data:{user}}=await db.auth.getUser();if(!user)redirect("/login");
 const {data:profile}=await db.from("profiles").select("role,department_id").eq("id",user.id).single();
 if(profile?.role!=="manager"||!profile.department_id)redirect("/manager/dashboard");
 const [incidentResult,peopleResult,departmentResult]=await Promise.all([
  db.from("maintenance_incidents").select("*").eq("department_id",profile.department_id).order("reported_at",{ascending:false}).limit(300),
  db.from("profiles").select("id,full_name").eq("department_id",profile.department_id).eq("is_active",true).order("full_name"),
  db.from("departments").select("id,name").eq("id",profile.department_id).single()
 ]);
 const people=peopleResult.data||[];const names=new Map(people.map(p=>[p.id,p.full_name||"Employee"]));
 const incidents=(incidentResult.data||[]).map(i=>({...i,reported_name:names.get(i.reported_by)||"Employee",assignee_name:i.assigned_to?names.get(i.assigned_to)||"Employee":null,department_name:departmentResult.data?.name||"Department"}));
 return <main className="space-y-6"><header><p className="text-xs font-bold tracking-widest text-gold">MANAGER WORKSPACE</p><h1 className="mt-2 text-3xl font-semibold text-forest">Department maintenance register</h1><p className="mt-2 text-sm text-gray-500">Assign work, update progress and record repair costs for your department.</p></header>{incidentResult.error?<p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Maintenance register unavailable. Apply migration 0021.</p>:<MaintenanceWorkspace role="manager" userId={user.id} incidents={incidents as any} people={people}/>}</main>;
}