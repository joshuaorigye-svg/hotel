"use client";

import Link from "next/link";
import { useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Notification={id:string;title:string;message:string;href:string;read_at:string|null;created_at:string};
export function NotificationBell({initialNotifications=[]}:{initialNotifications:Notification[]}){
 const [items,setItems]=useState(initialNotifications);
 const [open,setOpen]=useState(false);
 const [busy,setBusy]=useState(false);
 const unread=items.filter(n=>!n.read_at).length;
 async function markOne(id:string){
  const {error}=await createClient().rpc("mark_notification_read",{p_notification_id:id});
  if(!error)setItems(current=>current.map(n=>n.id===id?{...n,read_at:new Date().toISOString()}:n));
 }
 async function markAll(){
  setBusy(true);const {error}=await createClient().rpc("mark_all_notifications_read");
  if(!error)setItems(current=>current.map(n=>({...n,read_at:n.read_at||new Date().toISOString()})));
  setBusy(false);
 }
 const date=(value:string)=>new Intl.DateTimeFormat("en-UG",{dateStyle:"medium",timeStyle:"short",timeZone:"Africa/Kampala"}).format(new Date(value));
 return <div className="relative">
  <button type="button" aria-label={`Notifications, ${unread} unread`} aria-expanded={open} onClick={()=>setOpen(v=>!v)} className="relative grid h-10 w-10 place-items-center rounded-xl border border-gray-200 text-forest hover:bg-gray-50">
   <Bell size={19}/>{unread>0&&<span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">{unread>9?"9+":unread}</span>}
  </button>
  {open&&<><button aria-label="Close notifications" className="fixed inset-0 z-30 cursor-default" onClick={()=>setOpen(false)}/><section className="absolute right-0 z-40 mt-2 w-[min(90vw,380px)] overflow-hidden rounded-2xl border border-gray-200 bg-white text-gray-800 shadow-xl">
   <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3"><div><h2 className="font-semibold text-forest">Notifications</h2><p className="text-xs text-gray-500">{unread} unread</p></div><button disabled={!unread||busy} onClick={markAll} className="flex items-center gap-1 text-xs font-semibold text-forest disabled:opacity-40"><CheckCheck size={15}/>Mark all read</button></div>
   <div className="max-h-[420px] overflow-y-auto">{items.length===0?<p className="p-7 text-center text-sm text-gray-500">You're all caught up. No notifications yet.</p>:items.map(n=><Link key={n.id} href={n.href} onClick={()=>{setOpen(false);if(!n.read_at)void markOne(n.id);}} className={`block border-b border-gray-50 px-4 py-3 hover:bg-cream ${n.read_at?"":"bg-amber-50/60"}`}><div className="flex items-start gap-2"><span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read_at?"bg-gray-200":"bg-amber-500"}`}/><div className="min-w-0"><p className="text-sm font-semibold text-forest">{n.title}</p><p className="mt-1 text-sm text-gray-600">{n.message}</p><p className="mt-1 text-[11px] text-gray-400">{date(n.created_at)}</p></div></div></Link>)}</div>
  </section></>}
 </div>;
}
