import {redirect} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
import {MaintenanceWorkspace} from "@/components/maintenance-workspace";
export const dynamic="force-dynamic";
export default async function StaffIncidentsPage(){
 const db=await createClient();const {data:{user}}=await db.auth.getUser();if(!user)redirect("/login");
 const {data:profile}=await db.from("profiles").select("role").eq("id",user.id).single();
 if(!profile||!["staff","manager"].includes(profile.role))redirect("/login");
 const {data:items,error}=await db.from("maintenance_incidents").select("*").eq("reported_by",user.id).order("reported_at",{ascending:false}).limit(100);
 const [{data:people},{data:departments}]=await Promise.all([db.from("profiles").select("id,full_name").eq("id",user.id),db.from("departments").select("id,name")]);
 const names=new Map((people||[]).map(p=>[p.id,p.full_name||"Employee"]));const depts=new Map((departments||[]).map(d=>[d.id,d.name]));
 const incidents=(items||[]).map(i=>({...i,reported_name:names.get(i.reported_by)||"You",assignee_name:null,department_name:depts.get(i.department_id)||"Department"}));
 return <main className="space-y-6"><header><p className="text-xs font-bold tracking-widest text-gold">STAFF WORKSPACE</p><h1 className="mt-2 text-3xl font-semibold text-forest">Report a maintenance issue</h1><p className="mt-2 text-sm text-gray-500">Report problems with rooms, equipment, facilities or safety so the right team can follow up.</p></header>{error?<p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Incident reporting is not ready. The administrator must apply migration 0021.</p>:<MaintenanceWorkspace role="staff" userId={user.id} incidents={incidents as any}/>}</main>;
}