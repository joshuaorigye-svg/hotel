"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Advance = { id: string; staff_id: string; amount: number | string; repayment_per_month: number | string; reason: string; status: string; rejection_reason: string | null; disbursement_reference: string | null; };
type Deduction = { id: string; staff_id: string; amount: number | string; reason: string; effective_month: string; status: string; rejection_reason: string | null; };
const money = (value: number | string) => new Intl.NumberFormat("en-UG", { style: "currency", currency: "UGX", maximumFractionDigits: 0 }).format(Number(value) || 0);

export function AdvanceDeductionControls({ advances, deductions, names, repaid, loadError = false }: {
  advances: Advance[]; deductions: Deduction[]; names: Record<string,string>; repaid: Record<string,number>; loadError?: boolean;
}) {
  const db=createClient(), router=useRouter();
  const [reasons,setReasons]=useState<Record<string,string>>({});
  const [references,setReferences]=useState<Record<string,string>>({});
  const [methods,setMethods]=useState<Record<string,string>>({});
  const [busy,setBusy]=useState("");
  const [message,setMessage]=useState("");
  const [isError,setIsError]=useState(false);
  async function review(kind:"advance"|"deduction",id:string,decision:"approve"|"reject"){
    setBusy(id);setMessage("");
    const reason=(reasons[id]||"").trim();
    if(decision==="reject"&&reason.length<5){setMessage("Enter a clear rejection reason before rejecting.");setIsError(true);setBusy("");return;}
    const fn=kind==="advance"?"review_staff_advance_request":"review_salary_deduction_request";
    const {error}=await db.rpc(fn,{p_request_id:id,p_decision:decision,p_rejection_reason:decision==="reject"?reason:null});
    if(error){setMessage(error.message);setIsError(true);}else{setMessage(`${kind==="advance"?"Advance":"Deduction"} request ${decision}d.`);setIsError(false);router.refresh();}
    setBusy("");
  }
  async function disburse(item:Advance){
    setBusy(item.id);setMessage("");
    const {error}=await db.rpc("record_staff_advance_disbursement",{p_request_id:item.id,p_payment_method:methods[item.id]||"mobile_money",p_payment_reference:(references[item.id]||"").trim()});
    if(error){setMessage(error.message);setIsError(true);}else{setMessage("Advance disbursement recorded.");setIsError(false);router.refresh();}
    setBusy("");
  }
  return <section className="space-y-5">
    {loadError&&<div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Advance and deduction requests are unavailable. Review and apply migration 0014 after migration 0013.</div>}
    {message&&<div role="status" className={`rounded-xl border p-3 text-sm ${isError?"border-red-200 bg-red-50 text-red-700":"border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{message}</div>}
    <div className="space-y-3"><div><h2 className="text-lg font-semibold text-forest">Staff advance requests</h2><p className="mt-1 text-sm text-gray-500">Approve first, then record the actual disbursement. Outstanding balances include scheduled and completed repayments.</p></div>
      {!advances.length?<p className="rounded-xl bg-white p-6 text-center text-sm text-gray-500">No advance requests.</p>:advances.map(item=><article key={item.id} className="rounded-xl border border-[#EAE6DC] bg-white p-4"><div className="flex flex-wrap justify-between gap-2"><div><p className="font-semibold text-forest">{names[item.staff_id]||"Employee"} · {money(item.amount)}</p><p className="mt-1 text-xs text-gray-500">{item.reason} · Repayment {money(item.repayment_per_month)}/month</p><p className="mt-1 text-xs text-gray-500">Outstanding: {money(Number(item.amount)-(repaid[item.id]||0))}</p></div><span className="h-fit rounded-full bg-cream px-3 py-1 text-xs capitalize">{item.status}</span></div>
      {item.status==="pending"&&<div className="mt-3 flex flex-wrap gap-2"><input aria-label="Rejection reason" placeholder="Reason required to reject" value={reasons[item.id]||""} onChange={e=>setReasons(old=>({...old,[item.id]:e.target.value}))} className="min-w-48 flex-1 rounded-lg border px-3 py-2 text-sm"/><button disabled={!!busy} onClick={()=>review("advance",item.id,"approve")} className="rounded-lg bg-forest px-3 py-2 text-sm text-white">Approve</button><button disabled={!!busy} onClick={()=>review("advance",item.id,"reject")} className="rounded-lg border border-rose-200 px-3 py-2 text-sm text-rose-700">Reject</button></div>}
      {item.status==="approved"&&<div className="mt-3 grid gap-2 sm:grid-cols-[150px_1fr_auto]"><select aria-label="Disbursement method" value={methods[item.id]||"mobile_money"} onChange={e=>setMethods(old=>({...old,[item.id]:e.target.value}))} className="rounded-lg border px-3 py-2 text-sm"><option value="mobile_money">Mobile money</option><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option></select><input aria-label="Disbursement reference" placeholder="Actual payment reference" value={references[item.id]||""} onChange={e=>setReferences(old=>({...old,[item.id]:e.target.value}))} className="rounded-lg border px-3 py-2 text-sm"/><button disabled={!!busy} onClick={()=>disburse(item)} className="rounded-lg bg-forest px-3 py-2 text-sm text-white">Record disbursement</button></div>}
      {item.rejection_reason&&<p className="mt-2 text-xs text-rose-700">Rejection reason: {item.rejection_reason}</p>}</article>)}
    </div>
    <div className="space-y-3"><div><h2 className="text-lg font-semibold text-forest">Salary deduction proposals</h2><p className="mt-1 text-sm text-gray-500">Approved deductions are included only in the requested month’s payroll.</p></div>
      {!deductions.length?<p className="rounded-xl bg-white p-6 text-center text-sm text-gray-500">No deduction proposals.</p>:deductions.map(item=><article key={item.id} className="rounded-xl border border-[#EAE6DC] bg-white p-4"><div className="flex flex-wrap justify-between gap-2"><div><p className="font-semibold text-forest">{names[item.staff_id]||"Employee"} · {money(item.amount)}</p><p className="mt-1 text-xs text-gray-500">{item.reason} · Effective {item.effective_month}</p></div><span className="h-fit rounded-full bg-cream px-3 py-1 text-xs capitalize">{item.status}</span></div>
      {item.status==="pending"&&<div className="mt-3 flex flex-wrap gap-2"><input aria-label="Rejection reason" placeholder="Reason required to reject" value={reasons[item.id]||""} onChange={e=>setReasons(old=>({...old,[item.id]:e.target.value}))} className="min-w-48 flex-1 rounded-lg border px-3 py-2 text-sm"/><button disabled={!!busy} onClick={()=>review("deduction",item.id,"approve")} className="rounded-lg bg-forest px-3 py-2 text-sm text-white">Approve</button><button disabled={!!busy} onClick={()=>review("deduction",item.id,"reject")} className="rounded-lg border border-rose-200 px-3 py-2 text-sm text-rose-700">Reject</button></div>}
      {item.rejection_reason&&<p className="mt-2 text-xs text-rose-700">Rejection reason: {item.rejection_reason}</p>}</article>)}
    </div>
  </section>;
}
