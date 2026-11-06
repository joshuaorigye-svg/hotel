"use client";
import {useMemo,useState} from "react";
import {createClient} from "@/lib/supabase/client";
type Order={id:string;order_number:number;guest_name:string|null;order_type:string;status:string;total_amount:number;created_at:string};
type Payment={id:string;restaurant_order_id:string;amount:number;currency:string;status:string;payment_method:string|null;receipt_number:string|null;created_at:string};
export function RestaurantCashier({departmentId,orders,payments}:{departmentId:string;orders:Order[];payments:Payment[]}){
 const db=createClient();
 const [rows,setRows]=useState(payments),[amounts,setAmounts]=useState<Record<string,string>>({}),[methods,setMethods]=useState<Record<string,string>>({}),[codes,setCodes]=useState<Record<string,string>>({}),[busy,setBusy]=useState(""),[message,setMessage]=useState("");
 const paidByOrder=useMemo(()=>rows.filter(p=>p.status==="completed").reduce((a,p)=>({...a,[p.restaurant_order_id]:(a[p.restaurant_order_id]||0)+Number(p.amount)}),{} as Record<string,number>),[rows]);
 const money=(n:number)=>new Intl.NumberFormat("en-UG",{maximumFractionDigits:0}).format(n)+" UGX";
 const open=orders.filter(o=>o.status!=="cancelled"&&Number(o.total_amount)>(paidByOrder[o.id]||0));
 const today=new Date().toLocaleDateString("en-CA",{timeZone:"Africa/Kampala"});
 const todaysPayments=rows.filter(p=>p.status==="completed"&&new Date(p.created_at).toLocaleDateString("en-CA",{timeZone:"Africa/Kampala"})===today);
 const todayTotal=todaysPayments.reduce((s,p)=>s+Number(p.amount),0);
 async function collect(order:Order){
  setBusy(order.id);setMessage("");
  const {data,error}=await db.rpc("record_restaurant_payment",{p_order_id:order.id,p_amount:Number(amounts[order.id]),p_payment_method:methods[order.id]||"cash",p_confirmation_code:codes[order.id]||null});
  if(error){setMessage(error.message);setBusy("");return;}
  const {data:payment,error:readError}=await db.from("payments").select("id,restaurant_order_id,amount,currency,status,payment_method,receipt_number,created_at").eq("receipt_number",data).single();
  if(readError){setMessage("Payment saved. Receipt "+data+". Refresh to see the updated payment.");}
  else if(payment){setRows(v=>[payment as Payment,...v]);setMessage("Payment received. Receipt: "+data);}
  setAmounts(v=>({...v,[order.id]:""}));setCodes(v=>({...v,[order.id]:""}));setBusy("");
 }
 return <section className="space-y-4 rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft">
  <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold tracking-widest text-gold">CASHIER</p><h2 className="mt-1 text-xl font-semibold text-forest">Payments & receipts</h2><p className="mt-1 text-sm text-gray-500">Record cash, mobile money, card or bank payments against service orders.</p></div><div className="rounded-xl bg-cream p-4"><p className="text-xs text-gray-500">Collected today</p><p className="mt-1 text-xl font-bold text-forest">{money(todayTotal)}</p><p className="text-xs text-gray-500">{todaysPayments.length} payment(s)</p></div></div>
  {message&&<p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
  {!open.length?<p className="rounded-xl bg-cream p-5 text-sm text-gray-500">No outstanding restaurant or bar orders.</p>:<div className="space-y-3">{open.map(o=>{const paid=paidByOrder[o.id]||0;const due=Math.max(0,Number(o.total_amount)-paid);return <article key={o.id} className="rounded-xl border border-[#EAE6DC] p-4"><div className="flex flex-wrap justify-between gap-2"><div><h3 className="font-semibold text-forest">Order #{o.order_number} · {o.guest_name||o.order_type.replace("_"," ")}</h3><p className="text-xs text-gray-500">Total {money(Number(o.total_amount))} · Paid {money(paid)}</p></div><b className="text-forest">Due {money(due)}</b></div><div className="mt-3 grid gap-2 sm:grid-cols-4"><input aria-label="Payment amount in UGX" type="number" min="1" max={due} step="1" value={amounts[o.id]||String(due)} onChange={e=>setAmounts(v=>({...v,[o.id]:e.target.value}))} className="min-w-0 rounded-lg border p-2 text-sm"/><select aria-label="Payment method" value={methods[o.id]||"cash"} onChange={e=>setMethods(v=>({...v,[o.id]:e.target.value}))} className="rounded-lg border p-2 text-sm"><option value="cash">Cash</option><option value="mobile_money">Mobile money</option><option value="card">Card</option><option value="bank_transfer">Bank transfer</option><option value="pesapal">Pesapal</option></select><input aria-label="Payment reference" value={codes[o.id]||""} onChange={e=>setCodes(v=>({...v,[o.id]:e.target.value}))} placeholder="Transaction reference" className="min-w-0 rounded-lg border p-2 text-sm"/><button disabled={!!busy||!Number(amounts[o.id]||due)} onClick={()=>collect(o)} className="rounded-lg bg-forest px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy===o.id?"Saving…":"Receive payment"}</button></div></article>})}</div>}
  <div><h3 className="font-semibold text-forest">Recent receipts</h3>{!rows.length?<p className="py-4 text-sm text-gray-500">No payments recorded yet.</p>:<div className="mt-2 divide-y">{rows.slice(0,12).map(p=><div key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"><div><b className="text-forest">{p.receipt_number||"Payment"}</b><p className="text-xs text-gray-500">{p.payment_method?.replace("_"," ")||"Payment"} · {new Date(p.created_at).toLocaleString("en-UG")}</p></div><b>{money(Number(p.amount))}</b></div>)}</div>}</div>
 </section>;
}
