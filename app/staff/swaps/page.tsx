import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ShiftSwapWorkspace } from "@/components/shift-swap-workspace";
export const dynamic="force-dynamic";
export default async function StaffShiftSwapsPage(){
 const db=await createClient();const {data:{user}}=await db.auth.getUser();if(!user)redirect("/login");
 const {data:profile}=await db.from("profiles").select("role,department_id").eq("id",user.id).single();
 if(!profile||!["staff","manager"].includes(profile.role))redirect("/login");
 const now=new Date().toISOString();
 const [shiftResult,requestResult,peopleResult]=await Promise.all([
  db.from("staff_shift_assignments").select("id,staff_id,shift_name,starts_at,ends_at,department_id").eq("department_id",profile.department_id).eq("status","scheduled").gte("starts_at",now).order("starts_at").limit(150),
  db.from("staff_shift_swap_requests").select("*").or(`requester_id.eq.${user.id},target_id.eq.${user.id}`).order("created_at",{ascending:false}).limit(50),
  db.from("profiles").select("id,full_name").eq("department_id",profile.department_id)
 ]);
 const shifts=shiftResult.data||[];const requests=requestResult.data||[];const people=peopleResult.data||[];
 const names=new Map(people.map(p=>[p.id,p.full_name||"Employee"]));
 const shiftMap=new Map(shifts.map(s=>[s.id,{...s,staff_name:names.get(s.staff_id)||"Employee"}]));
 const enriched=requests.map(r=>({...r,requester_name:names.get(r.requester_id)||"Employee",target_name:names.get(r.target_id)||"Employee",requester_shift:shiftMap.get(r.requester_shift_id)||null,target_shift:shiftMap.get(r.target_shift_id)||null}));
 return <main className="space-y-6"><header><p className="text-xs font-bold tracking-widest text-gold">STAFF WORKSPACE</p><h1 className="mt-2 text-3xl font-semibold text-forest">Shift exchanges</h1><p className="mt-2 text-sm text-gray-500">Request a colleague&apos;s shift, respond to requests, and follow approval.</p></header>{shiftResult.error||requestResult.error?<p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Shift exchange is not available yet. The hotel administrator must apply migrations 0018 and 0019.</p>:<ShiftSwapWorkspace role="staff" userId={user.id} shifts={shifts.map(s=>({...s,staff_name:names.get(s.staff_id)||"Employee"}))} requests={enriched}/>}</main>;
}