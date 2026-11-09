"use client";

import {useMemo,useState} from "react";

type StatementInvoice={
 id:string;
 supplier_id:string;
 invoice_number:string;
 invoice_date:string;
 due_date:string|null;
 total_amount:number;
 status:string;
 paid_at:string|null;
 payment_method:string|null;
 payment_reference:string|null;
 inventory_suppliers?:{name:string}|null;
};

type Entry={
 id:string;
 date:string;
 supplier:string;
 reference:string;
 description:string;
 debit:number;
 credit:number;
};

const money=(value:number)=>new Intl.NumberFormat("en-UG",{style:"currency",currency:"UGX",maximumFractionDigits:0}).format(value);
const csvCell=(value:string|number)=>{const raw=String(value??"");return /[",\n\r]/.test(raw)||/^[=+@-]/.test(raw)?'"'+raw.replace(/"/g,'""')+'"':raw;};

export function SupplierStatementWorkspace({invoices}:{invoices:StatementInvoice[]}){
 const [supplierId,setSupplierId]=useState("all");
 const [fromDate,setFromDate]=useState("");
 const [toDate,setToDate]=useState("");
 const today=new Date().toISOString().slice(0,10);
 const suppliers=useMemo(()=>{
  const map=new Map<string,string>();
  invoices.forEach(i=>map.set(i.supplier_id,i.inventory_suppliers?.name||"Supplier"));
  return [...map.entries()].sort((a,b)=>a[1].localeCompare(b[1]));
 },[invoices]);
 const selected=invoices.filter(i=>supplierId==="all"||i.supplier_id===supplierId);
 const payable=selected.filter(i=>i.status==="approved"||i.status==="paid");
 const entries=useMemo(()=>{
  const rows:Entry[]=[];
  payable.forEach(i=>{
   rows.push({id:i.id+"-invoice",date:i.invoice_date,supplier:i.inventory_suppliers?.name||"Supplier",reference:i.invoice_number,description:"Supplier invoice approved",debit:Number(i.total_amount)||0,credit:0});
   if(i.status==="paid"&&i.paid_at){
    rows.push({id:i.id+"-payment",date:i.paid_at.slice(0,10),supplier:i.inventory_suppliers?.name||"Supplier",reference:i.payment_reference||i.invoice_number,description:"Payment · "+(i.payment_method||"recorded"),debit:0,credit:Number(i.total_amount)||0});
   }
  });
  return rows.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
 },[payable]);
 const opening=entries.filter(e=>fromDate&&e.date<fromDate).reduce((sum,e)=>sum+e.debit-e.credit,0);
 const visible=entries.filter(e=>(!fromDate||e.date>=fromDate)&&(!toDate||e.date<=toDate));
 const closing=opening+visible.reduce((sum,e)=>sum+e.debit-e.credit,0);
 const outstanding=selected.filter(i=>i.status==="approved");
 const asOf=new Date(today+"T00:00:00");
 const age=outstanding.reduce((buckets,i)=>{
  const due=new Date((i.due_date||i.invoice_date)+"T00:00:00");
  const days=Math.max(0,Math.floor((asOf.getTime()-due.getTime())/86400000));
  const amount=Number(i.total_amount)||0;
  const key=days===0?"current":days<=30?"d1_30":days<=60?"d31_60":days<=90?"d61_90":"d90";
  buckets[key]+=amount;
  return buckets;
 },{current:0,d1_30:0,d31_60:0,d61_90:0,d90:0});
 const totalOutstanding=outstanding.reduce((sum,i)=>sum+Number(i.total_amount||0),0);
 function exportCsv(){
  const rows=[["Date","Supplier","Reference","Description","Debit (UGX)","Credit (UGX)","Running balance (UGX)"]];
  let balance=opening;
  visible.forEach(e=>{balance+=e.debit-e.credit;rows.push([e.date,e.supplier,e.reference,e.description,String(e.debit),String(e.credit),String(balance)]);});
  const csv=rows.map(row=>row.map(csvCell).join(",")).join("\r\n");
  const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
  const link=document.createElement("a");link.href=url;link.download="supplier-statement.csv";link.click();URL.revokeObjectURL(url);
 }
 return <section className="rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft">
  <div className="flex flex-wrap items-start justify-between gap-3">
   <div><h2 className="font-semibold text-forest">Supplier statements & payable ageing</h2><p className="mt-1 text-sm text-gray-500">A read-only account statement from approved invoices and recorded payments. Pending invoices are excluded until approved.</p></div>
   <button type="button" onClick={exportCsv} disabled={!visible.length} className="rounded-lg border border-forest px-3 py-2 text-sm font-semibold text-forest disabled:opacity-40">Export statement CSV</button>
  </div>
  <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
   <label className="grid gap-1 text-xs text-gray-500">Supplier
    <select value={supplierId} onChange={e=>setSupplierId(e.target.value)} className="rounded-lg border p-2.5 text-sm text-gray-800"><option value="all">All suppliers</option>{suppliers.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select>
   </label>
   <label className="grid gap-1 text-xs text-gray-500">Statement from
    <input type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)} className="rounded-lg border p-2.5 text-sm"/>
   </label>
   <label className="grid gap-1 text-xs text-gray-500">Statement to
    <input type="date" min={fromDate||undefined} value={toDate} onChange={e=>setToDate(e.target.value)} className="rounded-lg border p-2.5 text-sm"/>
   </label>
  </div>
  <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
   <article className="rounded-xl bg-[#F7F8F5] p-4"><p className="text-xs text-gray-500">Outstanding approved payables</p><p className="mt-1 text-xl font-semibold text-forest">{money(totalOutstanding)}</p></article>
   <article className="rounded-xl bg-[#F7F8F5] p-4"><p className="text-xs text-gray-500">Opening balance</p><p className="mt-1 text-xl font-semibold text-forest">{money(opening)}</p></article>
   <article className="rounded-xl bg-[#F7F8F5] p-4"><p className="text-xs text-gray-500">Closing balance</p><p className="mt-1 text-xl font-semibold text-forest">{money(closing)}</p></article>
  </div>
  <div className="mt-4">
   <h3 className="text-sm font-semibold text-forest">Ageing summary · outstanding approved invoices</h3>
   <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
    {([["Current",age.current],["1–30 days",age.d1_30],["31–60 days",age.d31_60],["61–90 days",age.d61_90],[ "90+ days",age.d90]] as [string,number][]).map(([label,value])=><div key={label} className="rounded-lg border p-3"><p className="text-xs text-gray-500">{label}</p><p className="mt-1 text-sm font-semibold text-forest">{money(value)}</p></div>)}
   </div>
   <p className="mt-2 text-xs text-gray-400">Ageing is calculated as of {today}. Invoices without a due date use their invoice date.</p>
  </div>
  <div className="mt-4 overflow-x-auto rounded-xl border">
   <table className="w-full min-w-[720px] text-left text-sm">
    <thead className="bg-gray-50 text-xs text-gray-500"><tr><th className="p-3">Date</th><th className="p-3">Supplier / reference</th><th className="p-3">Entry</th><th className="p-3 text-right">Debit</th><th className="p-3 text-right">Credit</th><th className="p-3 text-right">Balance</th></tr></thead>
    <tbody>
     {fromDate&&<tr className="border-t bg-[#F7F8F5]"><td className="p-3" colSpan={5}>Opening balance</td><td className="p-3 text-right font-semibold">{money(opening)}</td></tr>}
     {(()=>{let balance=opening;return visible.map(e=>{balance+=e.debit-e.credit;return <tr key={e.id} className="border-t"><td className="p-3 whitespace-nowrap">{e.date}</td><td className="p-3"><b className="text-forest">{e.supplier}</b><p className="text-xs text-gray-400">{e.reference}</p></td><td className="p-3">{e.description}</td><td className="p-3 text-right">{e.debit?money(e.debit):"—"}</td><td className="p-3 text-right">{e.credit?money(e.credit):"—"}</td><td className="p-3 text-right font-medium">{money(balance)}</td></tr>;});})()}
     {visible.length===0&&<tr><td colSpan={6} className="p-6 text-center text-sm text-gray-400">No approved invoice or payment entries match this statement period.</td></tr>}
    </tbody>
   </table>
  </div>
  <p className="mt-3 text-xs text-gray-400">Statement entries include approved invoices as debits and recorded payments as credits. This report does not create, edit or settle financial records.</p>
 </section>;
}
