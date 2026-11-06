"use client";
import Link from "next/link";
import { useState } from "react";
import { BrandMark } from "@/components/brand";
import { hotel } from "@/config/hotel";

type Item = { description: string; quantity: number; unit_amount: number; total_amount: number };
type Payment = { amount: number; currency: string; method: string | null; receipt_number: string | null; reference: string | null; created_at: string };
type Portal = { booking_id: string; guest_name: string; status: string; check_in: string; check_out: string; guests: number; room_type: string | null; room_number: string | null; nights: number; charges: number; paid: number; balance: number; items: Item[]; payments: Payment[]; message: string };

export default function BookingStatusPage() {
  const [reference, setReference] = useState("");
  const [phone, setPhone] = useState("");
  const [record, setRecord] = useState<Portal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const money = (n: number) => new Intl.NumberFormat("en-UG", { style: "currency", currency: "UGX", maximumFractionDigits: 0 }).format(Number(n) || 0);
  const date = (value: string) => new Intl.DateTimeFormat("en-UG", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Kampala" }).format(new Date(value));
  const dateTime = (value: string) => new Intl.DateTimeFormat("en-UG", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Kampala" }).format(new Date(value));
  async function lookup(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(""); setRecord(null);
    try {
      const response = await fetch("/api/public/booking/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ booking_reference: reference.trim(), phone: phone.trim() }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "We could not find that booking.");
      setRecord(result.booking as Portal);
    } catch (err) { setError(err instanceof Error ? err.message : "Please check your details and try again."); }
    finally { setBusy(false); }
  }
  const statusLabel: Record<string,string> = { pending: "Awaiting confirmation", confirmed: "Confirmed", checked_in: "Checked in", checked_out: "Checked out", cancelled: "Cancelled" };
  return <main className="min-h-screen bg-cream">
    <header className="bg-white px-5 py-3"><Link href="/" className="flex items-center gap-3 font-semibold text-forest"><BrandMark size={48}/><span>{hotel.name}</span></Link></header>
    <div className="mx-auto max-w-3xl px-5 py-10">
      <p className="text-xs font-bold tracking-widest text-gold">GUEST PORTAL</p><h1 className="mt-2 text-3xl font-semibold text-forest">Check your booking</h1>
      <p className="mt-2 text-sm text-gray-600">Enter the full booking reference and the phone number used when making the request. Keep these details private.</p>
      <form onSubmit={lookup} className="mt-6 grid gap-3 rounded-2xl bg-white p-5 shadow-soft sm:grid-cols-2">
        <label className="text-sm font-medium text-forest sm:col-span-2">Booking reference<input required value={reference} onChange={e=>setReference(e.target.value)} placeholder="Paste your booking reference" className="mt-2 w-full rounded-xl border p-3 font-normal"/></label>
        <label className="text-sm font-medium text-forest sm:col-span-2">Phone number used for booking<input required value={phone} onChange={e=>setPhone(e.target.value)} placeholder="e.g. 077..." className="mt-2 w-full rounded-xl border p-3 font-normal"/></label>
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700 sm:col-span-2">{error}</p>}
        <button disabled={busy} className="rounded-xl bg-forest px-5 py-3 font-semibold text-white disabled:opacity-50 sm:col-span-2">{busy?"Checking…":"View booking"}</button>
      </form>
      {record && <section className="mt-6 space-y-5 rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft print:mt-0 print:border-0 print:shadow-none">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4"><div><p className="text-xs font-bold tracking-widest text-gold">BOOKING SUMMARY</p><h2 className="mt-1 text-xl font-semibold text-forest">{record.guest_name}</h2><p className="mt-1 break-all text-xs text-gray-500">Reference: {record.booking_id}</p></div><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold capitalize text-emerald-800">{statusLabel[record.status] || record.status}</span></div>
        <p className="rounded-xl bg-cream p-4 text-sm text-forest">{record.message}</p>
        <div className="grid gap-4 text-sm sm:grid-cols-2"><div><p className="text-xs text-gray-500">Check-in</p><p className="font-semibold">{date(record.check_in)}</p></div><div><p className="text-xs text-gray-500">Check-out</p><p className="font-semibold">{date(record.check_out)}</p></div><div><p className="text-xs text-gray-500">Guests</p><p className="font-semibold">{record.guests}</p></div><div><p className="text-xs text-gray-500">Room</p><p className="font-semibold">{record.room_number ? "Room "+record.room_number : record.room_type || "Not assigned yet"}</p></div></div>
        {record.items.length>0 && <div><h3 className="mb-2 font-semibold text-forest">Itemised charges</h3><div className="space-y-2">{record.items.map((item,i)=><div key={i} className="flex justify-between gap-3 border-b py-2 text-sm"><div><p>{item.description}</p><p className="text-xs text-gray-500">{item.quantity} × {money(item.unit_amount)}</p></div><b>{money(item.total_amount)}</b></div>)}</div></div>}
        {record.status==="checked_in" || record.status==="checked_out" ? <div className="rounded-xl border p-4 text-sm"><div className="flex justify-between"><span>Total charges</span><b>{money(record.charges)}</b></div><div className="mt-2 flex justify-between"><span>Payments received</span><b>{money(record.paid)}</b></div><div className="mt-3 flex justify-between border-t pt-3 text-base font-bold text-forest"><span>Balance</span><span>{money(record.balance)}</span></div></div> : record.paid>0 ? <p className="text-sm">Deposit/payment received: <b>{money(record.paid)}</b></p> : null}
        {record.payments.length>0 && <div><h3 className="mb-2 font-semibold text-forest">Payment history</h3><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b text-gray-500"><th className="py-2">Date</th><th>Method</th><th>Receipt</th><th className="text-right">Amount</th></tr></thead><tbody>{record.payments.map((p,i)=><tr key={i} className="border-b"><td className="py-2">{dateTime(p.created_at)}</td><td className="capitalize">{(p.method||"online").replace(/_/g," ")}</td><td>{p.receipt_number||p.reference||"—"}</td><td className="text-right">{money(p.amount)}</td></tr>)}</tbody></table></div></div>}
        <div className="flex flex-wrap gap-3 print:hidden"><button onClick={()=>window.print()} className="rounded-xl border border-forest px-4 py-2 text-sm font-semibold text-forest">Print / save as PDF</button><Link href="/booking" className="rounded-xl bg-forest px-4 py-2 text-sm font-semibold text-white">New booking</Link></div>
      </section>}
      <p className="mt-6 text-center text-xs text-gray-500">Need help? Contact {hotel.name} on {hotel.phone}.</p>
    </div>
  </main>;
}
