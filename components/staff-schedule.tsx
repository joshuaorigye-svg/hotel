"use client";
import {useCallback,useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase/client";
import {Clock3,Plus,RefreshCw,XCircle} from "lucide-react";
type Department={id:string;name:string;slug:string};
type Person={id:string;full_name:string;role:string;department_id:string};
type Shift={id:string;staff_id:string;department_id:string;shift_date:string;starts_at:string;ends_at:string;notes:string|null;status:string};\ntype Attendance={id:string;staff_id:string;clock_in:string;clock_out:string|null;status:string};
const key=(d:Date)=>d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
const monday=(v:Date)=>{const d=new Date(v);d.setHours(0,0,0,0);d.setDate(d.getDate()-((d.getDay()+6)%7));return d;};
export function StaffSchedule({mode,departmentId}:{mode:"owner"|"manager"|"staff";departmentId?:string}){
 const db=useMemo(()=>createClient(),[]);
 const [departments,setDepartments]=useState<Department[]>([]),[people,setPeople]=useState<Person[]>([]),[shifts,setShifts]=useState<Shift[]>([]),[attendance,setAttendance]=useState<Attendance[]>([]),[attendanceError,setAttendanceError]=useState(""),[names,setNames]=useState<Record<string,string>>({});
 const [selectedDepartment,setSelectedDepartment]=useState(departmentId||""),[weekStart,setWeekStart]=useState(""),[staffId,setStaffId]=useState(""),[date,setDate]=useState(""),[start,setStart]=useState("08:00"),[end,setEnd]=useState("17:00"),[notes,setNotes]=useState("");
 const [busy,setBusy]=useState(""),[message,setMessage]=useState(""),[error,setError]=useState(""),[loading,setLoading]=useState(true);
 useEffect(()=>{const m=key(monday(new Date()));setWeekStart(m);setDate(m);},[]);
 const load=useCallback(async()=>{
  if(!weekStart)return;setLoading(true);setError("");
  const until=new Date(weekStart+"T12:00:00");until.setDate(until.getDate()+7);
  const auth=await db.auth.getUser();const userId=auth.data.user?.id;
  const deptPromise=mode==="owner"?db.from("departments").select("id,name,slug").neq("slug","accounts-finance").order("name"):Promise.resolve({data:[] as Department[],error:null});
  const peoplePromise=mode==="owner"?db.from("profiles").select("id,full_name,role,department_id").eq("is_active",true).in("role",["staff","manager"]).order("full_name"):db.from("profiles").select("id,full_name,role,department_id").eq("department_id",departmentId).eq("is_active",true).in("role",["staff","manager"]).order("full_name");
  let shiftQuery=db.from("staff_shifts").select("id,staff_id,department_id,shift_date,starts_at,ends_at,notes,status").gte("shift_date",weekStart).lt("shift_date",key(until)).order("shift_date").order("starts_at");
  if(mode==="staff")shiftQuery=shiftQuery.eq("staff_id",userId||"");
  const [dr,pr,sr]=await Promise.all([deptPromise,peoplePromise,shiftQuery]);
  if(dr.error||pr.error||sr.error){setError((sr.error||pr.error||dr.error)?.message||"Could not load shifts.");setLoading(false);return;}
  const ds=(dr.data||[]) as Department[],ps=(pr.data||[]) as Person[];
  setDepartments(ds);setPeople(ps);setNames(Object.fromEntries(ps.map(p=>[p.id,p.full_name])));
  if(mode==="owner"&&!selectedDepartment&&ds[0])setSelectedDepartment(ds[0].id);
  setShifts((sr.data||[]) as Shift[]);setLoading(false);
 },[db,mode,departmentId,weekStart,selectedDepartment]);
 useEffect(()=>{load();},[load]);
 const activePeople=people.filter(p=>mode!=="owner"||p.department_id===selectedDepartment);
 useEffect(()=>{if(activePeople.length&&!activePeople.some(p=>p.id===staffId))setStaffId(activePeople[0].id);},[activePeople,staffId]);
 const selectedDept=mode==="owner"?selectedDepartment:(departmentId||"");
 async function createShift(e:React.FormEvent){
  e.preventDefault();setBusy("create");setMessage("");setError("");
  const person=people.find(p=>p.id===staffId);
  if(!person){setError("Choose an active team member.");setBusy("");return;}
  const auth=await db.auth.getUser();
  const {error:writeError}=await db.from("staff_shifts").insert({staff_id:staffId,department_id:selectedDept||person.department_id,shift_date:date,starts_at:start,ends_at:end,notes:notes.trim()||null,created_by:auth.data.user?.id});
  if(writeError)setError(writeError.message);else{setMessage("Shift scheduled successfully.");setNotes("");await load();}
  setBusy("");
 }
 async function cancelShift(id:string){
  if(!window.confirm("Cancel this shift?"))return;setBusy(id);setError("");setMessage("");
  const {error:e}=await db.rpc("cancel_staff_shift",{p_shift_id:id});
  if(e)setError(e.message);else{setMessage("Shift cancelled.");await load();}
  setBusy("");
 }
 const days=Array.from({length:7},(_,i)=>{const d=new Date(weekStart+"T12:00:00");d.setDate(d.getDate()+i);return key(d);});
 const moveWeek=(n:number)=>{const d=new Date(weekStart+"T12:00:00");d.setDate(d.getDate()+n*7);setWeekStart(key(d));};
 return <div className="space-y-6">
  {message&&<p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
  {error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
  {mode!=="staff"&&<section className="rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft">
   <div className="flex items-center gap-2"><Plus className="text-leaf"/><h2 className="font-semibold text-forest">Assign a shift</h2></div>
   <form onSubmit={createShift} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
    {mode==="owner"&&<select required value={selectedDepartment} onChange={e=>setSelectedDepartment(e.target.value)} className="rounded-xl border p-3 text-sm"><option value="">Choose department</option>{departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select>}
    <select required value={staffId} onChange={e=>setStaffId(e.target.value)} className="rounded-xl border p-3 text-sm"><option value="">Choose team member</option>{activePeople.map(p=><option key={p.id} value={p.id}>{p.full_name} · {p.role}</option>)}</select>
    <input required type="date" value={date} onChange={e=>setDate(e.target.value)} className="rounded-xl border p-3 text-sm"/>
    <label className="text-xs text-gray-500">Start time<input required type="time" value={start} onChange={e=>setStart(e.target.value)} className="mt-1 block w-full rounded-xl border p-3 text-sm"/></label>
    <label className="text-xs text-gray-500">End time<input required type="time" value={end} onChange={e=>setEnd(e.target.value)} className="mt-1 block w-full rounded-xl border p-3 text-sm"/></label>
    <input value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Shift notes (optional)" className="rounded-xl border p-3 text-sm"/>
    <button disabled={!!busy||!staffId||(mode==="owner"&&!selectedDept)} className="rounded-xl bg-forest px-4 py-3 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-2 lg:col-span-3">{busy==="create"?"Saving shift…":"Schedule shift"}</button>
   </form>
   <p className="mt-3 text-xs text-gray-400">Same-day shifts only. Overlaps and approved leave are blocked automatically.</p>
  </section>}
  <section className="rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft">
   <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-forest">{mode==="staff"?"My shifts":"Weekly rota"}</h2><p className="mt-1 text-xs text-gray-500">Week starting {weekStart}</p></div><div className="flex flex-wrap gap-2"><button onClick={()=>moveWeek(-1)} className="rounded-lg border px-3 py-2 text-sm">Previous</button><button onClick={()=>setWeekStart(key(monday(new Date())))} className="rounded-lg border px-3 py-2 text-sm">This week</button><button onClick={()=>moveWeek(1)} className="rounded-lg border px-3 py-2 text-sm">Next</button><button aria-label="Refresh shifts" onClick={load} className="rounded-lg border p-2"><RefreshCw size={16}/></button></div></div>
   {loading?<p className="py-12 text-center text-sm text-gray-400">Loading schedule…</p>:<div className="mt-5 space-y-3">{attendanceError&&mode!=="staff"&&<p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">{attendanceError}</p>}{days.map(day=>{const rows=shifts.filter(s=>s.shift_date===day);const d=new Date(day+"T12:00:00");return <div key={day} className="rounded-xl bg-cream p-4"><div className="flex items-center justify-between"><p className="font-semibold text-forest">{d.toLocaleDateString("en-UG",{weekday:"long",day:"numeric",month:"short"})}</p><span className="text-xs text-gray-500">{rows.filter(r=>r.status==="scheduled").length} scheduled</span></div>{!rows.length?<p className="mt-2 text-xs text-gray-400">No shifts assigned.</p>:<div className="mt-3 space-y-2">{rows.map(s=>{const logs=attendance.filter(a=>a.staff_id===s.staff_id&&a.clock_in.slice(0,10)===day).sort((a,b)=>a.clock_in.localeCompare(b.clock_in));const first=logs[0];const last=logs.find(a=>a.clock_out);const now=new Date();const shiftStart=new Date(day+"T"+s.starts_at);const grace=new Date(shiftStart.getTime()+15*60000);let presence=s.status==="cancelled"?"Cancelled":last?"Clocked out":first?"Present":now>grace?"Not clocked in":"Upcoming";const late=!!first&&new Date(first.clock_in).getTime()>shiftStart.getTime()+10*60000;return <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white bg-white p-3"><div className="min-w-0"><p className="text-sm font-semibold text-forest">{mode==="staff"?"Your shift":(names[s.staff_id]||"Team member")}</p><p className="mt-1 flex items-center gap-1 text-xs text-gray-500"><Clock3 size={13}/>{s.starts_at.slice(0,5)} – {s.ends_at.slice(0,5)}{s.notes?" · "+s.notes:""}</p>{first&&<p className="mt-1 text-xs text-gray-500">Clock-in {new Date(first.clock_in).toLocaleTimeString("en-UG",{hour:"2-digit",minute:"2-digit"})}{last?" · Clock-out "+new Date(last.clock_out!).toLocaleTimeString("en-UG",{hour:"2-digit",minute:"2-digit"}):""}</p>}</div><div className="flex items-center gap-2"><span className={"rounded-full px-3 py-1 text-xs "+(presence==="Present"||presence==="Clocked out"?"bg-emerald-50 text-emerald-700":presence==="Not clocked in"||late?"bg-amber-50 text-amber-800":"bg-gray-100 text-gray-500")}>{late&&presence==="Present"?"Late arrival":presence}</span>{mode!=="staff"&&s.status==="scheduled"&&<button disabled={!!busy} onClick={()=>cancelShift(s.id)} aria-label="Cancel shift" className="rounded-lg p-2 text-red-600 hover:bg-red-50"><XCircle size={17}/></button>}</div></div>})}</div>}</div>})}</div>}
  </section>
 </div>;
}
