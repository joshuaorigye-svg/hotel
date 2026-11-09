"use client";

import {useMemo,useState} from "react";
import {useRouter} from "next/navigation";
import {createClient} from "@/lib/supabase/client";
import {SupplierInvoiceDocuments} from "@/components/supplier-invoice-documents";
import {SupplierStatementWorkspace} from "@/components/supplier-statement-workspace";

type POLine={id:string;inventory_item_id:string;quantity_ordered:number;quantity_received:number;quantity_invoiced:number;unit_cost:number;inventory_items?:{name:string;unit:string}|null};
type PurchaseOrder={id:string;order_number:number;department_id:string;status:string;inventory_suppliers?:{name:string}|null;inventory_purchase_order_items:POLine[]};
type InvoiceLine={id:string;quantity:number;unit_price:number;line_total:number;inventory_items?:{name:string;unit:string}|null;inventory_purchase_order_items?:{unit_cost:number}|{unit_cost:number}[]|null};
type InvoiceDocument={id:string;file_name:string;mime_type:string;size_bytes:number;document_type:"invoice"|"delivery_note"|"receipt"|"other";storage_path:string;created_at:string};
type Invoice={id:string;supplier_id:string;invoice_number:string;invoice_date:string;due_date:string|null;total_amount:number;status:string;notes:string|null;review_note:string|null;payment_method:string|null;payment_reference:string|null;paid_at:string|null;reviewed_at:string|null;created_at:string;inventory_suppliers?:{name:string}|null;inventory_purchase_orders?:{order_number:number}|null;inventory_supplier_invoice_lines:InvoiceLine[];inventory_supplier_invoice_documents?:InvoiceDocument[]};

const cash=(v:number|string)=>new Intl.NumberFormat("en-UG",{style:"currency",currency:"UGX",maximumFractionDigits:0}).format(Number(v)||0);
const methods=["cash","mobile_money","bank_transfer","card","pesapal"];

export function SupplierInvoiceWorkspace({role,purchaseOrders,invoices}:{role:"owner"|"manager";purchaseOrders:PurchaseOrder[];invoices:Invoice[]}){
 const db=createClient();const router=useRouter();
 const eligible=useMemo(()=>purchaseOrders.filter(p=>["partially_received","received"].includes(p.status)),[purchaseOrders]);
 const [poId,setPoId]=useState(eligible[0]?.id||"");
 const [invoiceNumber,setInvoiceNumber]=useState("");
 const [invoiceDate,setInvoiceDate]=useState("");
 const [dueDate,setDueDate]=useState("");
 const [notes,setNotes]=useState("");
 const [quantities,setQuantities]=useState<Record<string,string>>({});
 const [prices,setPrices]=useState<Record<string,string>>({});
 const [reviewNotes,setReviewNotes]=useState<Record<string,string>>({});
 const [paymentMethods,setPaymentMethods]=useState<Record<string,string>>({});
 const [references,setReferences]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState("");
 const [error,setError]=useState("");
 const [message,setMessage]=useState("");
 const selected=eligible.find(p=>p.id===poId);
 const availableLines=(selected?.inventory_purchase_order_items||[]).filter(l=>Number(l.quantity_received)-Number(l.quantity_invoiced)>0);
 const pending=invoices.filter(i=>i.status==="pending");
 const approved=invoices.filter(i=>i.status==="approved");
 const totalPending=pending.reduce((s,i)=>s+Number(i.total_amount),0);
 const totalApproved=approved.reduce((s,i)=>s+Number(i.total_amount),0);\n const priceVarianceCount=pending.filter(invoice=>invoice.inventory_supplier_invoice_lines.some(line=>{const poLine=Array.isArray(line.inventory_purchase_order_items)?line.inventory_purchase_order_items[0]:line.inventory_purchase_order_items;const base=Number(poLine?.unit_cost||0);return base>0&&Math.abs((Number(line.unit_price)-base)/base)>0.05;})).length;

 async function submitInvoice(e:React.FormEvent<HTMLFormElement>){
  e.preventDefault();setBusy("submit");setError("");setMessage("");
  const lines=(selected?.inventory_purchase_order_items||[]).map(line=>({purchase_order_item_id:line.id,quantity:Number(quantities[line.id]||0),unit_price:Number(prices[line.id]??line.unit_cost)})).filter(line=>line.quantity>0);
  if(!lines.length){setError("Enter an invoice quantity for at least one received item.");setBusy("");return;}
  if(lines.some(line=>!Number.isFinite(line.quantity)||line.quantity<=0||!Number.isFinite(line.unit_price)||line.unit_price<0)){setError("Check the invoice quantities and unit prices.");setBusy("");return;}
  const {error}=await db.rpc("submit_supplier_invoice",{p_purchase_order_id:poId,p_invoice_number:invoiceNumber.trim(),p_invoice_date:invoiceDate,p_due_date:dueDate||null,p_notes:notes.trim()||null,p_lines:lines});
  if(error)setError(error.message);else{setMessage("Supplier invoice submitted for owner review.");setInvoiceNumber("");setInvoiceDate("");setDueDate("");setNotes("");setQuantities({});setPrices({});router.refresh();}
  setBusy("");
 }
 async function review(id:string,decision:"approved"|"rejected"){
  const note=reviewNotes[id]?.trim()||"";
  if(decision==="rejected"&&note.length<3){setError("Add a reason before rejecting this invoice.");return;}
  setBusy(id);setError("");setMessage("");
  const {error}=await db.rpc("review_supplier_invoice",{p_invoice_id:id,p_decision:decision,p_note:note||null});
  if(error)setError(error.message);else{setMessage(decision==="approved"?"Invoice approved and added to approved expenses awaiting payment.":"Invoice rejected.");router.refresh();}
  setBusy("");
 }
 async function pay(id:string){
  setBusy("pay-"+id);setError("");setMessage("");
  const {error}=await db.rpc("pay_supplier_invoice",{p_invoice_id:id,p_payment_method:paymentMethods[id]||"bank_transfer",p_payment_reference:references[id]?.trim()||null});
  if(error)setError(error.message);else{setMessage("Supplier invoice payment recorded through the expense payment ledger.");router.refresh();}
  setBusy("");
 }
 return <div className="space-y-6">
  {(error||message)&&<div role={error?"alert":"status"} className={error?"rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800":"rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"}>{error||message}</div>}
  <section className="grid gap-3 sm:grid-cols-3">
   <article className="rounded-2xl border bg-white p-4"><p className="text-xs text-gray-500">Invoices awaiting review</p><p className="mt-2 text-2xl font-semibold text-forest">{pending.length}</p><p className="text-xs text-gray-400">{cash(totalPending)} submitted</p></article>
   <article className="rounded-2xl border bg-white p-4"><p className="text-xs text-gray-500">Approved, awaiting payment</p><p className="mt-2 text-2xl font-semibold text-forest">{approved.length}</p><p className="text-xs text-gray-400">{cash(totalApproved)} payable</p></article>
   <article className="rounded-2xl border bg-white p-4"><p className="text-xs text-gray-500">Price variance flags</p><p className="mt-2 text-2xl font-semibold text-forest">{priceVarianceCount}</p><p className="text-xs text-gray-400">Pending invoices with over 5% unit-price difference</p></article>
  </section>

  <form onSubmit={submitInvoice} className="rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft">
   <h2 className="font-semibold text-forest">Record supplier invoice</h2>
   <p className="mt-1 text-sm text-gray-500">Match the supplier document to goods already received. The system prevents invoicing more than the received quantity.</p>
   <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    <label className="grid gap-1 text-xs text-gray-500 sm:col-span-2">Received purchase order
     <select required value={poId} onChange={e=>{setPoId(e.target.value);setQuantities({});setPrices({});}} className="rounded-lg border p-2.5 text-sm text-gray-800">
      {eligible.length===0&&<option value="">No received purchase orders available</option>}
      {eligible.map(p=><option key={p.id} value={p.id}>PO #{p.order_number} · {p.inventory_suppliers?.name||"Supplier"} · {p.status.replaceAll("_"," ")}</option>)}
     </select>
    </label>
    <label className="grid gap-1 text-xs text-gray-500">Supplier invoice number
     <input required maxLength={100} value={invoiceNumber} onChange={e=>setInvoiceNumber(e.target.value)} className="rounded-lg border p-2.5 text-sm" placeholder="e.g. INV-1042"/>
    </label>
    <label className="grid gap-1 text-xs text-gray-500">Invoice date
     <input required type="date" value={invoiceDate} onChange={e=>setInvoiceDate(e.target.value)} className="rounded-lg border p-2.5 text-sm"/>
    </label>
    <label className="grid gap-1 text-xs text-gray-500">Due date (optional)
     <input type="date" min={invoiceDate||undefined} value={dueDate} onChange={e=>setDueDate(e.target.value)} className="rounded-lg border p-2.5 text-sm"/>
    </label>
   </div>
   {selected&&<div className="mt-4 overflow-x-auto rounded-xl border">
    <table className="w-full min-w-[680px] text-left text-sm">
     <thead className="bg-gray-50 text-xs text-gray-500"><tr><th className="p-3">Received item</th><th className="p-3">Received</th><th className="p-3">Already invoiced</th><th className="p-3">Available to invoice</th><th className="p-3">Invoice quantity</th><th className="p-3">Unit price (UGX)</th></tr></thead>
     <tbody>{availableLines.map(line=>{const remaining=Number(line.quantity_received)-Number(line.quantity_invoiced);return <tr key={line.id} className="border-t">
      <td className="p-3 font-medium text-forest">{line.inventory_items?.name||"Stock item"}<p className="text-xs font-normal text-gray-400">{line.inventory_items?.unit||""}</p></td>
      <td className="p-3">{line.quantity_received}</td><td className="p-3">{line.quantity_invoiced}</td><td className="p-3 font-semibold text-emerald-700">{remaining}</td>
      <td className="p-3"><input aria-label={"Invoice quantity for "+(line.inventory_items?.name||"item")} type="number" min="0" max={remaining} step="0.001" value={quantities[line.id]||""} onChange={e=>setQuantities(s=>({...s,[line.id]:e.target.value}))} className="w-28 rounded-lg border p-2"/></td>
      <td className="p-3"><input aria-label={"Invoice unit price for "+(line.inventory_items?.name||"item")} type="number" min="0" step="1" value={prices[line.id]??String(line.unit_cost)} onChange={e=>setPrices(s=>({...s,[line.id]:e.target.value}))} className="w-32 rounded-lg border p-2"/></td>
     </tr>})}
     {availableLines.length===0&&<tr><td colSpan={6} className="p-5 text-center text-sm text-gray-400">All received quantities on this purchase order have already been invoiced.</td></tr>}</tbody>
    </table>
   </div>}
   <label className="mt-3 grid gap-1 text-xs text-gray-500">Notes
    <textarea rows={2} maxLength={1000} value={notes} onChange={e=>setNotes(e.target.value)} className="rounded-lg border p-2.5 text-sm" placeholder="Delivery note, tax details or other reference"/>
   </label>
   <button disabled={!!busy||!selected||availableLines.length===0} className="mt-4 rounded-lg bg-forest px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy==="submit"?"Submitting…":"Submit invoice for owner review"}</button>
  </form>

  {role==="owner"&&<section className="rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft">
   <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold text-forest">Owner invoice review</h2><p className="mt-1 text-sm text-gray-500">Approval creates one approved expense. Payment is recorded separately.</p></div><span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">{pending.length} pending</span></div>
   {pending.length===0?<p className="py-6 text-center text-sm text-gray-400">No supplier invoices awaiting review.</p>:<div className="mt-4 space-y-3">
    {pending.map(invoice=><article key={invoice.id} className="rounded-xl border p-4">
     <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold text-forest">{invoice.inventory_suppliers?.name||"Supplier"} · {invoice.invoice_number}</p><p className="mt-1 text-xs text-gray-500">PO #{invoice.inventory_purchase_orders?.order_number??"—"} · Invoice date {invoice.invoice_date}</p></div><b>{cash(invoice.total_amount)}</b></div>
     <div className="mt-3 overflow-x-auto rounded-lg border"><table className="w-full min-w-[560px] text-left text-xs"><thead className="bg-gray-50 text-gray-500"><tr><th className="p-2">Item</th><th className="p-2 text-right">PO unit cost</th><th className="p-2 text-right">Invoice unit price</th><th className="p-2 text-right">Difference</th><th className="p-2 text-right">Line total</th></tr></thead><tbody>{invoice.inventory_supplier_invoice_lines.map(line=>{const poLine=Array.isArray(line.inventory_purchase_order_items)?line.inventory_purchase_order_items[0]:line.inventory_purchase_order_items;const baseline=Number(poLine?.unit_cost||0);const difference=Number(line.unit_price)-baseline;const variance=baseline>0?difference/baseline*100:null;const flagged=variance!==null&&Math.abs(variance)>5;return <tr key={line.id} className="border-t"><td className="p-2">{line.inventory_items?.name||"Item"} · {line.quantity}</td><td className="p-2 text-right">{baseline?cash(baseline):"Not set"}</td><td className="p-2 text-right">{cash(line.unit_price)}</td><td className={"p-2 text-right font-semibold "+(flagged?"text-rose-700":"text-gray-600")}>{variance===null?"—":(variance>0?"+":"")+variance.toFixed(1)+"%"}</td><td className="p-2 text-right">{cash(line.line_total)}</td></tr>})}</tbody></table></div><p className="mt-2 text-xs text-gray-400">Price differences above 5% are flagged for review against the purchase order. A flag is a review aid, not an automatic rejection.</p>
     {invoice.notes&&<p className="mt-2 text-xs text-gray-500">{invoice.notes}</p>}
     <input value={reviewNotes[invoice.id]||""} onChange={e=>setReviewNotes(s=>({...s,[invoice.id]:e.target.value}))} maxLength={500} placeholder="Review note, or reason if rejecting" className="mt-3 w-full rounded-lg border p-2.5 text-sm"/>
     <div className="mt-3 flex justify-end gap-2"><button type="button" disabled={!!busy} onClick={()=>review(invoice.id,"rejected")} className="rounded-lg border border-rose-200 px-4 py-2 text-sm font-medium text-rose-700 disabled:opacity-50">Reject</button><button type="button" disabled={!!busy} onClick={()=>review(invoice.id,"approved")} className="rounded-lg bg-forest px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy===invoice.id?"Saving…":"Approve & create payable"}</button></div>
    </article>)}
   </div>}
  </section>}

  {role==="owner"&&<section className="rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft">
   <h2 className="font-semibold text-forest">Approved invoices awaiting payment</h2>
   <p className="mt-1 text-sm text-gray-500">Paying here also marks the linked expense as paid, using the existing expense payment workflow.</p>
   {approved.length===0?<p className="py-6 text-center text-sm text-gray-400">No approved supplier invoices are awaiting payment.</p>:<div className="mt-4 space-y-3">
    {approved.map(invoice=><article key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
     <div><p className="font-semibold text-forest">{invoice.inventory_suppliers?.name||"Supplier"} · {invoice.invoice_number}</p><p className="mt-1 text-xs text-gray-500">Due {invoice.due_date||"date not supplied"} · {cash(invoice.total_amount)}</p></div>
     <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Payment method" value={paymentMethods[invoice.id]||"bank_transfer"} onChange={e=>setPaymentMethods(s=>({...s,[invoice.id]:e.target.value}))} className="rounded-lg border p-2 text-sm">{methods.map(m=><option key={m} value={m}>{m.replaceAll("_"," ")}</option>)}</select>
      <input aria-label="Payment reference" value={references[invoice.id]||""} onChange={e=>setReferences(s=>({...s,[invoice.id]:e.target.value}))} maxLength={160} placeholder="Payment reference" className="w-36 rounded-lg border p-2 text-sm"/>
      <button type="button" disabled={!!busy} onClick={()=>pay(invoice.id)} className="rounded-lg bg-forest px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy==="pay-"+invoice.id?"Saving…":"Record payment"}</button>
     </div>
    </article>)}
   </div>}
  </section>}

  <section className="rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft">
  <SupplierStatementWorkspace invoices={invoices}/>

   <h2 className="font-semibold text-forest">Supplier invoice register</h2>
   <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-gray-50 text-xs text-gray-500"><tr><th className="p-3">Supplier / invoice</th><th className="p-3">Purchase order</th><th className="p-3">Invoice date</th><th className="p-3">Amount</th><th className="p-3">Status</th><th className="p-3">Payment</th><th className="p-3">Documents</th></tr></thead><tbody>
    {invoices.map(i=><tr key={i.id} className="border-t"><td className="p-3"><b className="text-forest">{i.inventory_suppliers?.name||"Supplier"}</b><p className="text-xs text-gray-500">{i.invoice_number}</p></td><td className="p-3">#{i.inventory_purchase_orders?.order_number??"—"}</td><td className="p-3">{i.invoice_date}</td><td className="p-3 font-medium">{cash(i.total_amount)}</td><td className="p-3"><span className={i.status==="paid"?"text-emerald-700":i.status==="rejected"?"text-rose-700":i.status==="pending"?"text-amber-700":"text-forest"}>{i.status}</span>{i.review_note&&<p className="max-w-[180px] text-xs text-gray-400">{i.review_note}</p>}</td><td className="p-3 text-xs">{i.status==="paid"?(i.payment_method||"Paid")+" · "+(i.payment_reference||"No reference"):"—"}</td><td className="min-w-[310px] p-3"><SupplierInvoiceDocuments invoiceId={i.id} status={i.status} role={role} documents={i.inventory_supplier_invoice_documents||[]}/></td></tr>)}
    {invoices.length===0&&<tr><td colSpan={7} className="p-6 text-center text-sm text-gray-400">No supplier invoices recorded yet.</td></tr>}
   </tbody></table></div>
  </section>
 </div>;
}
