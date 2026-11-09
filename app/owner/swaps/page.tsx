import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ShiftSwapWorkspace } from "@/components/shift-swap-workspace";
export const dynamic="force-dynamic";
export default async function OwnerShiftSwapsPage(){
 const db=await createClient();const {data:{user}}=await db.auth.getUser();if(!user)redirect("/login");
 const {data:profile}=await db.from("profiles").select("role").eq("id",user.id).single();if(profile?.role!=="owner")redirect("/staff/tasks");
 const [shiftResult,requestResult,peopleResult]=await Promise.all([
  db.from("staff_shift_assignments").select("id,staff_id,shift_name,starts_at,ends_at,department_id").eq("status","scheduled").order("starts_at").limit(500),
  db.from("staff_shift_swap_requests").select("*").order("created_at",{ascending:false}).limit(200),
  db.from("profiles").select("id,full_name")
 ]);
 const shifts=shiftResult.data||[];const requests=requestResult.data||[];const names=new Map((peopleResult.data||[]).map(p=>[p.id,p.full_name||"Employee"]));
 const shiftMap=new Map(shifts.map(s=>[s.id,{...s,staff_name:names.get(s.staff_id)||"Employee"}]));
 const enriched=requests.map(r=>({...r,requester_name:names.get(r.requester_id)||"Employee",target_name:names.get(r.target_id)||"Employee",requester_shift:shiftMap.get(r.requester_shift_id)||null,target_shift:shiftMap.get(r.target_shift_id)||null}));
 return <main className="space-y-6"><header><p className="text-xs font-bold tracking-widest text-gold">OWNER OFFICE</p><h1 className="mt-2 text-3xl font-semibold text-forest">Hotel-wide shift exchanges</h1><p className="mt-2 text-sm text-gray-500">Review employee-approved exchanges across departments.</p></header>{shiftResult.error||requestResult.error?<p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Shift exchanges are unavailable. Apply migration 0019 after migration 0018.</p>:<ShiftSwapWorkspace role="owner" userId={user.id} shifts={shifts.map(s=>({...s,staff_name:names.get(s.staff_id)||"Employee"}))} requests={enriched}/>}</main>;
}