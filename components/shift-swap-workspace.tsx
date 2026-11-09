"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Shift = { id:string; staff_id:string; staff_name:string; shift_name:string; starts_at:string; ends_at:string; department_id:string };
type Swap = { id:string; requester_id:string; target_id:string; requester_shift_id:string; target_shift_id:string; status:string; target_note:string|null; decision_note:string|null; created_at:string; requester_name:string; target_name:string; requester_shift:Shift|null; target_shift:Shift|null };
const fmt=(v:string)=>new Intl.DateTimeFormat("en-UG",{dateStyle:"medium",timeStyle:"short",timeZone:"Africa/Kampala"}).format(new Date(v));

export function ShiftSwapWorkspace({ role, userId, shifts, requests, colleagues=[] }: {role:"staff"|"manager"|"owner";userId:string;shifts:Shift[];requests:Swap[];colleagues?:{id:string;full_name:string}[]}) {
  const router=useRouter();
  const [ownShift,setOwnShift]=useState("");
  const [otherShift,setOtherShift]=useState("");
  const [note,setNote]=useState("");
  const [decisionNote,setDecisionNote]=useState("");
  const [busy,setBusy]=useState("");
  const [message,setMessage]=useState("");
  const [failed,setFailed]=useState(false);
  const ownOptions=useMemo(()=>shifts.filter(s=>s.staff_id===userId && new Date(s.starts_at)>new Date()),[shifts,userId]);
  const otherOptions=useMemo(()=>shifts.filter(s=>s.staff_id!==userId && new Date(s.starts_at)>new Date()),[shifts,userId]);
  const isReview=role!=="staff";
  async function call(name:string,args:Record<string,unknown>,key:string){
    setBusy(key);setMessage("");setFailed(false);
    const {error}=await createClient().rpc(name,args);
    setBusy("");setFailed(!!error);setMessage(error?.message||"Saved successfully.");
    if(!error){setNote("");setDecisionNote("");router.refresh();}
  }
  const statusLabel:Record<string,string>={pending_target:"Awaiting colleague",declined:"Declined by colleague",pending_manager:"Awaiting manager approval",approved:"Approved",rejected:"Rejected",cancelled:"Cancelled"};
  const shiftSummary=(s:Shift|null)=>s? s.shift_name+" · "+fmt(s.starts_at):"Shift details unavailable";
  return <div className="space-y-6">
    {message&&<p role="status" className={`rounded-xl p-3 text-sm ${failed?"bg-red-50 text-red-700":"bg-emerald-50 text-emerald-800"}`}>{message}</p>}
    {role!=="owner"&&<section className="rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft">
      <h2 className="font-semibold text-forest">Request a shift exchange</h2>
      <p className="mt-1 text-sm text-gray-500">Choose one of your future shifts and a colleague's future shift in your department. They must accept before a manager can approve.</p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="grid gap-1 text-sm font-medium text-forest">Your shift<select value={ownShift} onChange={e=>setOwnShift(e.target.value)} className="rounded-xl border border-gray-200 px-3 py-3"><option value="">Choose your shift</option>{ownOptions.map(s=><option key={s.id} value={s.id}>{s.shift_name} · {fmt(s.starts_at)}</option>)}</select></label>
        <label className="grid gap-1 text-sm font-medium text-forest">Colleague's shift<select value={otherShift} onChange={e=>setOtherShift(e.target.value)} className="rounded-xl border border-gray-200 px-3 py-3"><option value="">Choose colleague's shift</option>{otherOptions.map(s=><option key={s.id} value={s.id}>{s.staff_name} · {s.shift_name} · {fmt(s.starts_at)}</option>)}</select></label>
      </div>
      <label className="mt-3 grid gap-1 text-sm font-medium text-forest">Note (optional)<input value={note} onChange={e=>setNote(e.target.value)} maxLength={500} placeholder="Briefly explain the request" className="rounded-xl border border-gray-200 px-3 py-3"/></label>
      <button disabled={!!busy||!ownShift||!otherShift||ownShift===otherShift} onClick={()=>call("request_staff_shift_swap",{p_requester_shift_id:ownShift,p_target_shift_id:otherShift,p_note:note},"request")} className="mt-3 rounded-xl bg-forest px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">{busy==="request"?"Sending…":"Send swap request"}</button>
    </section>}
    <section className="overflow-hidden rounded-2xl border border-[#EAE6DC] bg-white shadow-soft">
      <div className="border-b border-[#EAE6DC] p-5"><h2 className="font-semibold text-forest">{isReview?"Department swap requests":"My swap requests"}</h2><p className="mt-1 text-xs text-gray-500">{requests.length} request(s) · all times Africa/Kampala</p></div>
      {!requests.length?<p className="p-8 text-center text-sm text-gray-500">No shift exchange requests to show.</p>:<div className="divide-y divide-gray-100">{requests.map(r=>{
        const incoming=r.target_id===userId&&r.status==="pending_target";
        const outgoing=r.requester_id===userId&&["pending_target","pending_manager"].includes(r.status);
        const reviewable=isReview&&r.status==="pending_manager"&&r.requester_id!==userId&&r.target_id!==userId;
        return <article key={r.id} className="space-y-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold text-forest">{r.requester_name} ↔ {r.target_name}</p><span className="rounded-full bg-[#F4F1E8] px-3 py-1 text-xs text-gray-700">{statusLabel[r.status]||r.status}</span></div>
          <div className="grid gap-2 text-sm md:grid-cols-2"><p><span className="text-gray-500">Requested shift:</span> {shiftSummary(r.requester_shift)}</p><p><span className="text-gray-500">Offered shift:</span> {shiftSummary(r.target_shift)}</p></div>
          {r.target_note&&<p className="text-sm text-gray-600">Colleague note: {r.target_note}</p>}{r.decision_note&&<p className="text-sm text-gray-600">Decision note: {r.decision_note}</p>}
          {incoming&&<div className="flex flex-wrap gap-2"><button disabled={!!busy} onClick={()=>call("respond_staff_shift_swap",{p_request_id:r.id,p_response:"accept",p_note:null},"respond")} className="rounded-lg bg-forest px-3 py-2 text-sm font-semibold text-white">Accept</button><button disabled={!!busy} onClick={()=>call("respond_staff_shift_swap",{p_request_id:r.id,p_response:"decline",p_note:null},"respond")} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold">Decline</button></div>}
          {outgoing&&<button disabled={!!busy} onClick={()=>call("cancel_staff_shift_swap",{p_request_id:r.id},"cancel")} className="text-sm font-semibold text-red-700 underline">Cancel request</button>}
          {reviewable&&<div className="space-y-2"><label className="grid gap-1 text-xs font-medium text-gray-600">Decision note (required for rejection)<input value={decisionNote} onChange={e=>setDecisionNote(e.target.value)} maxLength={500} className="rounded-lg border border-gray-200 px-3 py-2 text-sm"/></label><div className="flex flex-wrap gap-2"><button disabled={!!busy} onClick={()=>call("review_staff_shift_swap",{p_request_id:r.id,p_decision:"approve",p_decision_note:decisionNote},"review")} className="rounded-lg bg-forest px-3 py-2 text-sm font-semibold text-white">Approve exchange</button><button disabled={!!busy||decisionNote.trim().length<5} onClick={()=>call("review_staff_shift_swap",{p_request_id:r.id,p_decision:"reject",p_decision_note:decisionNote},"review")} className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 disabled:opacity-40">Reject</button></div></div>}
        </article>;
      })}</div>}
    </section>
    <p className="text-xs text-gray-400">A swap changes the two scheduled shift assignments only after colleague acceptance and manager/owner approval. The system blocks overlapping assignments and approved leave. No automatic notification is sent in this phase.</p>
  </div>;
}
