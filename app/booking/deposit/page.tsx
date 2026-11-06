"use client";
import Link from "next/link";
import { useState } from "react";
import { LoaderCircle, ShieldCheck } from "lucide-react";
import { BrandMark } from "@/components/brand";

export default function DepositPayment() {
  const [bookingId, setBookingId] = useState(""), [phone, setPhone] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/pesapal/order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookingId: bookingId.trim(), phone: phone.trim() }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Could not start payment.");
      window.location.assign(result.checkoutUrl);
    } catch (e) { setError(e instanceof Error ? e.message : "Please contact reception."); setBusy(false); }
  }
  return <main className="grid min-h-screen place-items-center bg-cream px-5 py-12"><section className="w-full max-w-lg rounded-2xl bg-white p-7 shadow-soft">
    <div className="mb-5 flex justify-center"><Link href="/"><BrandMark size={76} /></Link></div>
    <p className="text-center text-xs font-bold tracking-widest text-gold">SECURE DEPOSIT</p><h1 className="mt-2 text-center text-2xl font-semibold text-forest">Pay your booking deposit</h1>
    <p className="mt-2 text-sm leading-6 text-gray-500">Only bookings confirmed by reception with an assigned room can proceed to deposit payment. Your deposit is calculated as 30% of the room total.</p>
    <form onSubmit={submit} className="mt-6 space-y-4"><label className="block text-sm">Booking reference<input required value={bookingId} onChange={e => setBookingId(e.target.value)} placeholder="Paste the reference from your email" className="mt-2 w-full rounded-xl border p-3" /></label><label className="block text-sm">Phone number used for booking<input required value={phone} onChange={e => setPhone(e.target.value)} placeholder="07..." className="mt-2 w-full rounded-xl border p-3" /></label>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-forest px-5 py-4 font-semibold text-white disabled:opacity-50">{busy ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />}{busy ? "Connecting to Pesapal…" : "Continue to secure payment"}</button>
    </form><Link href="/" className="mt-5 block text-center text-sm text-leaf">Return to hotel website</Link>
  </section></main>;
}
