import { createClient } from "@/lib/supabase/server";
import { ReportExport } from "@/components/report-export";
import { CalendarDays, BedDouble, Wallet, Receipt, Utensils, Users, ClipboardCheck, Package } from "lucide-react";
export const dynamic = "force-dynamic";

const money = (n:number) => new Intl.NumberFormat("en-UG",{style:"currency",currency:"UGX",maximumFractionDigits:0}).format(n||0);
const monthKey = (value:string) => new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Kampala",year:"numeric",month:"2-digit"}).format(new Date(value));
const monthLabel = (key:string) => new Intl.DateTimeFormat("en-UG",{month:"short",year:"2-digit",timeZone:"UTC"}).format(new Date(key+"-01T00:00:00Z"));
function Metric({label,value,detail,icon:Icon}:{label:string;value:string;detail:string;icon:any}) { return <div className="rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft"><div className="flex items-center justify-between"><p className="text-sm text-gray-500">{label}</p><span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><Icon size={19}/></span></div><p className="mt-4 text-2xl font-semibold text-forest">{value}</p><p className="mt-1 text-xs text-gray-400">{detail}</p></div> }

export default async function Reports() {
 const db=await createClient();
 const now=new Date();
 const start=new Date(now); start.setUTCMonth(start.getUTCMonth()-11); start.setUTCDate(1); start.setUTCHours(0,0,0,0);
 const from=start.toISOString();
 const [payments,expenses,bookings,rooms,attendance,staff,tasks,orders,stock]=await Promise.all([
  db.from("payments").select("amount,currency,created_at,status").eq("status","completed").gte("created_at",from).order("created_at"),
  db.from("expenses").select("amount,approval_status,created_at,department_id").eq("approval_status","approved").gte("created_at",from),
  db.from("bookings").select("id,check_in,check_out,status").in("status",["confirmed","checked_in","checked_out"]).gte("check_out",start.toISOString().slice(0,10)),
  db.from("rooms").select("id,status,is_active").eq("is_active",true),
  db.from("attendance").select("id,staff_id,clock_in,status").gte("clock_in",from),
  db.from("profiles").select("id,department_id,role,is_active,departments(name)").eq("is_active",true),
  db.from("tasks").select("id,status,created_at,completed_at").gte("created_at",from),
  db.from("restaurant_orders").select("id,total_amount,status,created_at").gte("created_at",from).neq("status","cancelled"),
  db.from("inventory_items").select("id,quantity,low_stock_threshold,is_active").eq("is_active",true)
 ]);
 const results=[payments,expenses,bookings,rooms,attendance,staff,tasks,orders,stock];
 const failed=results.some(x=>x.error);
 const pay=payments.data||[], exp=expenses.data||[], book=bookings.data||[], room=rooms.data||[], att=attendance.data||[], task=tasks.data||[], order=orders.data||[], inv=stock.data||[];
 const revenue=pay.reduce((s:number,x:any)=>s+Number(x.amount||0),0);
 const costs=exp.reduce((s:number,x:any)=>s+Number(x.amount||0),0);
 const monthKeys=Array.from({length:12},(_,i)=>{const d=new Date(start);d.setUTCMonth(start.getUTCMonth()+i);return d.toISOString().slice(0,7)});
 const monthly=monthKeys.map(key=>({month:key,revenue:pay.filter((x:any)=>monthKey(x.created_at)===key).reduce((s:number,x:any)=>s+Number(x.amount||0),0),expenses:exp.filter((x:any)=>monthKey(x.created_at)===key).reduce((s:number,x:any)=>s+Number(x.amount||0),0)}));
 const daysIn=(y:number,m:number)=>new Date(Date.UTC(y,m,0)).getUTCDate();
 const todayKey=monthKey(now.toISOString());
 const roomCount=room.length;
 const roomNights=book.reduce((sum:number,b:any)=>{
  let count=0; const fromDate=new Date(b.check_in+"T00:00:00Z"),toDate=new Date(b.check_out+"T00:00:00Z");
  for(const key of monthKeys){const [y,m]=key.split("-").map(Number);const a=new Date(Date.UTC(y,m-1,1)),z=new Date(Date.UTC(y,m,1));const left=fromDate>a?fromDate:a,right=toDate<z?toDate:z;if(right>left)count+=(right-left)/(86400000);}
  return sum+count;
 },0);
 const availableNights=monthKeys.reduce((sum,key)=>{const [y,m]=key.split("-").map(Number);const cap=key===todayKey?now.getUTCDate():key>todayKey?0:daysIn(y,m);return sum+cap*roomCount;},0);
 const occupancy=availableNights?Math.min(100,roomNights/availableNights*100):0;
 const present= new Set(att.filter((x:any)=>x.status==="clocked_in").map((x:any)=>x.staff_id)).size;
 const done=task.filter((x:any)=>x.status==="done").length;
 const low=inv.filter((x:any)=>Number(x.quantity)<=Number(x.low_stock_threshold)).length;
 const deptTotals=new Map<string,number>();
 for(const x of exp){const profile=(staff.data||[]).find((p:any)=>p.department_id===x.department_id);const name=(profile?.departments as any)?.name||"Unassigned";deptTotals.set(name,(deptTotals.get(name)||0)+Number(x.amount||0));}
 const exportRows=[
  ["Monthly financial summary","Revenue (UGX)","Approved expenses (UGX)","Net after recorded expenses (UGX)"],
  ...monthly.map(x=>[x.month,String(x.revenue),String(x.expenses),String(x.revenue-x.expenses)]),
  [],
  ["Operational summary","Value"],
  ["Completed payments (UGX)",String(revenue)],["Approved expenses (UGX)",String(costs)],["Net after recorded expenses (UGX)",String(revenue-costs)],["Estimated occupancy (%)",occupancy.toFixed(1)],["Room nights from bookings",String(roomNights)],["Active rooms",String(roomCount)],["Active staff clocked in now",String(present)],["Tasks completed in period",String(done)],["Non-cancelled restaurant/bar orders",String(order.length)],["Low-stock items",String(low)]
 ];
 const max=Math.max(1,...monthly.flatMap(x=>[x.revenue,x.expenses]));
 return <div className="space-y-7">
  <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-medium text-gold">OWNER OFFICE</p><h1 className="mt-1 text-2xl font-semibold text-forest md:text-3xl">Hotel performance reports</h1><p className="mt-2 text-sm text-gray-500">A rolling 12-month view of recorded financial and operating activity.</p></div><ReportExport rows={exportRows} filename="buladde-hotel-performance-report.csv"/></div>
  {failed&&<div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Some report sections could not be loaded. Check that migrations 0001–0011 have been applied and review the relevant Supabase table permissions. Figures below use only records successfully returned.</div>}
  <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
   <Metric label="Completed payments" value={money(revenue)} detail="All completed payment records in period" icon={Wallet}/>
   <Metric label="Approved expenses" value={money(costs)} detail="Approved expenses recorded in period" icon={Receipt}/>
   <Metric label="Net recorded cash movement" value={money(revenue-costs)} detail="Payments less approved expenses, not audited profit" icon={CalendarDays}/>
   <Metric label="Estimated room occupancy" value={occupancy.toFixed(1)+"%"} detail={roomCount+" active rooms; booking-date estimate"} icon={BedDouble}/>
   <Metric label="Room nights booked" value={roomNights.toLocaleString("en-UG",{maximumFractionDigits:0})} detail="Confirmed, checked-in and checked-out bookings" icon={BedDouble}/>
   <Metric label="Staff clocked in now" value={String(present)} detail={(staff.data||[]).length+" active staff accounts" } icon={Users}/>
   <Metric label="Tasks completed" value={String(done)} detail="Tasks created during this reporting period" icon={ClipboardCheck}/>
   <Metric label="Restaurant & bar orders" value={String(order.length)} detail={money(order.reduce((s:number,x:any)=>s+Number(x.total_amount||0),0))+" order value; not added to payments"} icon={Utensils}/>
  </section>
  <section className="rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold text-forest">Monthly income and expenses</h2><p className="mt-1 text-xs text-gray-500">Based on payment and expense recording dates</p></div><div className="flex gap-4 text-xs"><span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-sm bg-emerald-600"/>Payments</span><span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-sm bg-amber-500"/>Expenses</span></div></div><div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">{monthly.map(x=><div key={x.month} className="min-w-0"><div className="mb-2 flex justify-between text-[11px] text-gray-500"><span>{monthLabel(x.month)}</span><span>{money(x.revenue)}</span></div><div className="flex h-24 items-end gap-1 rounded-lg bg-[#F7F5EF] px-2 pt-2"><div title={"Payments "+money(x.revenue)} className="min-w-1 flex-1 rounded-t bg-emerald-600" style={{height:Math.max(x.revenue?3:0,x.revenue/max*100)+"%"}}/><div title={"Expenses "+money(x.expenses)} className="min-w-1 flex-1 rounded-t bg-amber-500" style={{height:Math.max(x.expenses?3:0,x.expenses/max*100)+"%"}}/></div><p className="mt-1 truncate text-[10px] text-gray-400">Expenses: {money(x.expenses)}</p></div>)}</div></section>
  <div className="grid gap-5 xl:grid-cols-2">
   <section className="rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft"><h2 className="font-semibold text-forest">Approved expenses by department</h2>{deptTotals.size===0?<p className="py-8 text-center text-sm text-gray-400">No approved expenses in this period.</p>:Array.from(deptTotals.entries()).sort((a,b)=>b[1]-a[1]).map(([name,value])=><div key={name} className="border-b py-3 last:border-0"><div className="mb-2 flex justify-between gap-3 text-sm"><span>{name}</span><b>{money(value)}</b></div><div className="h-2 overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full bg-amber-500" style={{width:Math.min(100,value/Math.max(1,costs)*100)+"%"}}/></div></div>)}</section>
   <section className="rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft"><h2 className="font-semibold text-forest">Operational watchlist</h2><div className="mt-3 divide-y text-sm"><div className="flex justify-between py-3"><span>Low-stock inventory items</span><b className={low?"text-rose-700":"text-forest"}>{low}</b></div><div className="flex justify-between py-3"><span>Active hotel rooms</span><b>{roomCount}</b></div><div className="flex justify-between py-3"><span>Bookings included in occupancy estimate</span><b>{book.length}</b></div><div className="flex justify-between py-3"><span>Attendance records in period</span><b>{att.length}</b></div><div className="flex justify-between py-3"><span>Tasks created in period</span><b>{task.length}</b></div><div className="flex justify-between py-3"><span>Non-cancelled restaurant/bar orders</span><b>{order.length}</b></div></div><p className="mt-3 text-xs text-gray-400">Occupancy is estimated from booking dates and the current active room count. It is not a historical room-inventory snapshot.</p></section>
  </div>
  <p className="text-xs text-gray-400">Reporting period: {monthLabel(monthKeys[0])} to {monthLabel(monthKeys[11])}. Payments are counted once from the payments table. Restaurant order value is shown separately to avoid double-counting collections. Net recorded cash movement is not a formal profit-and-loss statement.</p>
 </div>;
}
