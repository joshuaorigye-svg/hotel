"use client";
import Link from "next/link";
import { useState } from "react";
import { BrandMark } from "@/components/brand";

export default function Booking() {
  const [form, setForm] = useState({ guest_name: "", guest_email: "", guest_phone: "", check_in: "", check_out: "", guests: "1", room_type: "", payment_option: "pay_at_hotel", notes: "" });
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [success, setSuccess] = useState(""), [reference, setReference] = useState("");
  function change(k: string, v: string) { setForm(s => ({ ...s, [k]: v })); }
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(""); setSuccess(""); setReference("");
    if (form.check_out <= form.check_in) { setError("Check-out must be after check-in."); setBusy(false); return; }
    try {
      const response = await fetch("/api/public/booking", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Booking request failed.");
      setSuccess(result.message); setReference(result.bookingId || "");
      setForm({ guest_name: "", guest_email: "", guest_phone: "", check_in: "", check_out: "", guests: "1", room_type: "", payment_option: "pay_at_hotel", notes: "" });
    } catch (e) { setError(e instanceof Error ? e.message : "Please try again or call reception."); }
    finally { setBusy(false); }
  }
  return <main className="min-h-screen bg-cream"><header className="bg-white px-5 py-3"><Link href="/" className="flex items-center gap-3 font-semibold text-forest"><BrandMark size={48} /><span>Buladde Palm Villa Hotel</span></Link></header>
    <div className="mx-auto max-w-2xl px-5 py-12"><p className="text-xs font-bold tracking-widest text-gold">RESERVATIONS</p><h1 className="mt-2 text-3xl font-semibold text-forest">Request a booking</h1><p className="mt-2 text-sm text-gray-500">Send your details. Your room is not reserved until reception confirms.</p><p className="mt-3 text-sm"><Link href="/booking/status" className="font-semibold text-forest underline">Already requested a booking? Check its status</Link></p>
      <form onSubmit={submit} className="mt-8 space-y-4 rounded-2xl bg-white p-5 shadow-soft md:p-8"><div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm">Full name<input required value={form.guest_name} onChange={e => change("guest_name", e.target.value)} className="mt-2 w-full rounded-xl border p-3" /></label>
        <label className="text-sm">Phone number<input required value={form.guest_phone} onChange={e => change("guest_phone", e.target.value)} placeholder="07..." className="mt-2 w-full rounded-xl border p-3" /></label>
        <label className="text-sm">Email (optional)<input type="email" value={form.guest_email} onChange={e => change("guest_email", e.target.value)} className="mt-2 w-full rounded-xl border p-3" /></label>
        <label className="text-sm">Room type<input value={form.room_type} onChange={e => change("room_type", e.target.value)} placeholder="Preferred room type" className="mt-2 w-full rounded-xl border p-3" /></label>
        <label className="text-sm">Check-in<input required type="date" min={new Date().toISOString().slice(0, 10)} value={form.check_in} onChange={e => change("check_in", e.target.value)} className="mt-2 w-full rounded-xl border p-3" /></label>
        <label className="text-sm">Check-out<input required type="date" min={form.check_in || new Date().toISOString().slice(0, 10)} value={form.check_out} onChange={e => change("check_out", e.target.value)} className="mt-2 w-full rounded-xl border p-3" /></label>
        <label className="text-sm">Number of guests<input required type="number" min="1" max="20" value={form.guests} onChange={e => change("guests", e.target.value)} className="mt-2 w-full rounded-xl border p-3" /></label>
        <label className="text-sm">Payment preference<select value={form.payment_option} onChange={e => change("payment_option", e.target.value)} className="mt-2 w-full rounded-xl border bg-white p-3"><option value="pay_at_hotel">Pay at hotel</option><option value="deposit">I want to pay a deposit</option></select></label>
      </div>
      <label className="block text-sm">Additional details<textarea rows={3} value={form.notes} onChange={e => change("notes", e.target.value)} className="mt-2 w-full rounded-xl border p-3" placeholder="Any special requests?" /></label>
      {form.payment_option === "deposit" && <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">Reception must first confirm your booking and assign a room. You can then use the booking reference to pay a deposit.</p>}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {success && <div role="status" className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800"><p>{success}</p><p className="mt-2 break-all font-semibold">Booking reference: {reference}</p><p className="mt-2">Keep this reference and your phone number. <Link href="/booking/status" className="font-bold underline">Track your booking and view payment history</Link>. Once reception confirms your room, you can <Link href="/booking/deposit" className="font-bold underline">pay your deposit here</Link>.</p></div>}
      <button disabled={busy} className="w-full rounded-xl bg-forest px-5 py-4 font-semibold text-white disabled:opacity-50">{busy ? "Sending request…" : "Send booking request"}</button></form></div></main>;
}
