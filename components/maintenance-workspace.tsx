"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Incident={
 id:string;department_id:string;reported_by:string;assigned_to:string|null;
 category:string;title:string;description:string;location:string;priority:string;status:string;
 estimated_cost:number|null;actual_cost:number|null;vendor_name:string|null;resolution_note:string|null;
 reported_at:string;reported_name:string;assignee_name:string|null;department_name:string;
};
type Person={id:string;full_name:string|null};
type Role="staff"|"manager"|"owner";
const categories=["plumbing","electrical","equipment","room","furniture","cleaning","security","other"];
const statuses=["open","acknowledged","in_progress","waiting_parts","resolved","closed","cancelled"];
const label=(v:string)=>v.replaceAll("_"," ").replace(/\b\w/g,c=>c.toUpperCase());
const money=(v:number|null)=>v===null?"Not recorded":new Intl.NumberFormat("en-UG",{style:"currency",currency:"UGX",maximumFractionDigits:0}).format(v);
const date=(v:string)=>new Intl.DateTimeFormat("en-UG",{dateStyle:"medium",timeStyle:"short",timeZone:"Africa/Kampala"}).format(new Date(v));

export function MaintenanceWorkspace({role,userId,incidents,people=[]}:{role:Role;userId:string;incidents:Incident[];people?:Person[]}){
 const [rows,setRows]=useState(incidents);
 const [category,setCategory]=useState("equipment"),[priority,setPriority]=useState("normal");
 const [title,setTitle]=useState(""),[description,setDescription]=useState(""),[location,setLocation]=useState("");
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const [drafts,setDrafts]=useState<Record<string,{status:string;assigned_to:string;estimated_cost:string;actual_cost:string;vendor_name:string;resolution_note:string}>>({});
 const [filter,setFilter]=useState("all");
 const visible=useMemo(()=>rows.filter(r=>filter==="all"||r.status===filter),[rows,filter]);
 function draft(r:Incident){return drafts[r.id]||{status:r.status,assigned_to:r.assigned_to||"",estimated_cost:r.estimated_cost?.toString()||"",actual_cost:r.actual_cost?.toString()||"",vendor_name:r.vendor_name||"",resolution_note:r.resolution_note||""};}
 function patch(id:string,key:string,value:string){const row=rows.find(r=>r.id===id);if(!row)return;const base={status:row.status,assigned_to:row.assigned_to||"",estimated_cost:row.estimated_cost?.toString()||"",actual_cost:row.actual_cost?.toString()||"",vendor_name:row.vendor_name||"",resolution_note:row.resolution_note||""};setDrafts(current=>({...current,[id]:{...base,...current[id],[key]:value}}));}
 async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);setError("");setNotice("");
  const {data,error}=await createClient().rpc("submit_maintenance_incident",{p_category:category,p_title:title,p_description:description,p_location:location,p_priority:priority});
  if(error)setError(error.message);else{setNotice("Incident submitted. Management can now review it.");setTitle("");setDescription("");setLocation("");}
  setBusy(false);
 }
 async function save(r:Incident){const d=draft(r);setBusy(true);setError("");setNotice("");
  const {error}=await createClient().rpc("update_maintenance_incident",{p_incident_id:r.id,p_status:d.status,p_assigned_to:d.assigned_to||null,p_estimated_cost:d.estimated_cost===""?null:Number(d.estimated_cost),p_actual_cost:d.actual_cost===""?null:Number(d.actual_cost),p_vendor_name:d.vendor_name||null,p_resolution_note:d.resolution_note||null});
  if(error)setError(error.message);else{setNotice("Incident updated and recorded in the audit log.");}
  setBusy(false);
 }
 return <div className="space-y-6">
  {error&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
  {notice&&<p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
  {role!=="owner"&&<form onSubmit={submit} className="space-y-4 rounded-2xl border border-[#EAE6DC] bg-white p-5">
   <div><h2 className="text-lg font-semibold text-forest">Report an incident</h2><p className="mt-1 text-sm text-gray-500">Describe what needs attention and where it is located.</p></div>
   <div className="grid gap-3 sm:grid-cols-2">
    <label className="grid gap-1 text-sm font-medium text-forest">Category<select value={category} onChange={e=>setCategory(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2">{categories.map(x=><option key={x} value={x}>{label(x)}</option>)}</select></label>
    <label className="grid gap-1 text-sm font-medium text-forest">Priority<select value={priority} onChange={e=>setPriority(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
    <label className="grid gap-1 text-sm font-medium text-forest sm:col-span-2">Short title<input required minLength={4} maxLength={120} value={title} onChange={e=>setTitle(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2" placeholder="e.g. Room 12 air conditioner not cooling"/></label>
    <label className="grid gap-1 text-sm font-medium text-forest sm:col-span-2">Location<input required minLength={2} maxLength={160} value={location} onChange={e=>setLocation(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2" placeholder="e.g. Room 12, kitchen, reception"/></label>
    <label className="grid gap-1 text-sm font-medium text-forest sm:col-span-2">What happened?<textarea required minLength={10} maxLength={4000} rows={4} value={description} onChange={e=>setDescription(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2" placeholder="Add enough detail for the team to understand the issue."/></label>
   </div>
   <button disabled={busy} className="rounded-lg bg-forest px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy?"Submitting…":"Submit incident"}</button>
  </form>}
  <section className="space-y-4">
   <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-semibold text-forest">{role==="staff"?"My reported incidents":"Maintenance & incident register"}</h2><p className="mt-1 text-sm text-gray-500">{rows.length} record(s) · Times shown in Kampala time</p></div><label className="grid gap-1 text-xs text-gray-500">Filter by status<select value={filter} onChange={e=>setFilter(e.target.value)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800"><option value="all">All statuses</option>{statuses.map(x=><option key={x} value={x}>{label(x)}</option>)}</select></label></div>
   {!visible.length?<div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">No incidents in this view.</div>:visible.map(r=>{const d=draft(r);return <article key={r.id} className="space-y-4 rounded-2xl border border-[#EAE6DC] bg-white p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-[#F4F1E8] px-2.5 py-1 text-xs font-semibold text-forest">{label(r.status)}</span><span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600">{label(r.priority)} priority</span><span className="text-xs text-gray-400">{label(r.category)}</span></div><h3 className="mt-2 text-lg font-semibold text-forest">{r.title}</h3><p className="mt-1 text-sm text-gray-600">{r.location} · {r.department_name}</p></div><p className="text-xs text-gray-400">{date(r.reported_at)}</p></div>
    <p className="whitespace-pre-wrap text-sm text-gray-700">{r.description}</p>
    <div className="grid gap-2 text-xs text-gray-500 sm:grid-cols-3"><p>Reported by: <strong className="text-gray-700">{r.reported_name}</strong></p><p>Assigned to: <strong className="text-gray-700">{r.assignee_name||"Unassigned"}</strong></p><p>Estimated: <strong className="text-gray-700">{money(r.estimated_cost)}</strong></p><p>Actual cost: <strong className="text-gray-700">{money(r.actual_cost)}</strong></p>{r.vendor_name&&<p>Vendor: <strong className="text-gray-700">{r.vendor_name}</strong></p>}</div>
    {r.resolution_note&&<p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">Resolution: {r.resolution_note}</p>}
    {role!=="staff"&&<div className="grid gap-3 border-t border-gray-100 pt-4 sm:grid-cols-2">
     <label className="grid gap-1 text-xs font-semibold text-gray-600">Status<select value={d.status} onChange={e=>patch(r.id,"status",e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-normal">{statuses.map(x=><option key={x} value={x}>{label(x)}</option>)}</select></label>
     <label className="grid gap-1 text-xs font-semibold text-gray-600">Assign to<select value={d.assigned_to} onChange={e=>patch(r.id,"assigned_to",e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-normal"><option value="">Unassigned</option>{people.filter(p=>p.id!==userId).map(p=><option key={p.id} value={p.id}>{p.full_name||"Employee"}</option>)}</select></label>
     <label className="grid gap-1 text-xs font-semibold text-gray-600">Estimated cost (UGX)<input type="number" min="0" step="1" value={d.estimated_cost} onChange={e=>patch(r.id,"estimated_cost",e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-normal"/></label>
     <label className="grid gap-1 text-xs font-semibold text-gray-600">Actual cost (UGX)<input type="number" min="0" step="1" value={d.actual_cost} onChange={e=>patch(r.id,"actual_cost",e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-normal"/></label>
     <label className="grid gap-1 text-xs font-semibold text-gray-600 sm:col-span-2">Vendor / service provider<input maxLength={160} value={d.vendor_name} onChange={e=>patch(r.id,"vendor_name",e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-normal"/></label>
     <label className="grid gap-1 text-xs font-semibold text-gray-600 sm:col-span-2">Resolution note (required when resolving)<textarea maxLength={2000} rows={2} value={d.resolution_note} onChange={e=>patch(r.id,"resolution_note",e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-normal"/></label>
     <div className="sm:col-span-2"><button disabled={busy} onClick={()=>void save(r)} className="rounded-lg bg-forest px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Save incident updates</button></div>
    </div>}
   </article>})}
  </section>
 </div>;
}
