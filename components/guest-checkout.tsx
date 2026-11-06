"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { BrandLogo } from "@/components/brand";
import { hotel } from "@/config/hotel";

type Booking = { id: string; guest_name: string; guest_phone: string; check_in: string; check_out: string; room_id: string | null; status: string };
type FolioItem = { id: string; description: string; quantity: number; unit_amount: number; total_amount: number };
type GuestPayment = { id: string; amount: number; currency: string; payment_method: string | null; confirmation_code: string | null; receipt_number: string | null; created_at: string; status: string };
type Summary = { booking_id: string; guest_name: string; guest_phone: string; room_number: string; check_in: string; check_out: string; nights: number; items: FolioItem[]; charges: number; paid: number; balance: number };

export function GuestCheckout({ initialBookings }: { initialBookings: Booking[] }) {
  const db = createClient();
  const [bookings, setBookings] = useState(initialBookings);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [payments, setPayments] = useState<GuestPayment[]>([]);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);

  const money = (v: number) => new Intl.NumberFormat("en-UG", { style: "currency", currency: "UGX", maximumFractionDigits: 0 }).format(Number(v) || 0);
  const date = (v: string) => new Intl.DateTimeFormat("en-UG", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Kampala" }).format(new Date(v));
  const dateTime = (v: string) => new Intl.DateTimeFormat("en-UG", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Kampala" }).format(new Date(v));

  async function load(id: string) {
    setBusy("load"); setMessage(""); setError(false); setPayments([]);
    const { data, error: folioError } = await db.rpc("get_guest_folio", { p_booking_id: id });
    if (folioError) { setError(true); setMessage(folioError.message); setBusy(""); return; }
    const next = data as Summary;
    setSummary(next);
    setAmount(String(Number(next.balance) || ""));
    const { data: paymentRows, error: paymentError } = await db.from("payments")
      .select("id,amount,currency,payment_method,confirmation_code,receipt_number,created_at,status")
      .eq("booking_id", id).eq("status", "completed").order("created_at", { ascending: true });
    if (paymentError) { setMessage("Folio loaded, but payment history could not be loaded: " + paymentError.message); setError(true); }
    else setPayments((paymentRows || []) as GuestPayment[]);
    setBusy("");
  }

  async function receive() {
    if (!summary) return;
    setBusy("pay"); setMessage(""); setError(false);
    const { data, error } = await db.rpc("record_guest_payment", { p_booking_id: summary.booking_id, p_amount: Number(amount), p_payment_method: method, p_confirmation_code: reference || null });
    if (error) { setError(true); setMessage(error.message); }
    else { setMessage("Payment received. Receipt: " + data); await load(summary.booking_id); }
    setBusy("");
  }

  async function checkout() {
    if (!summary) return;
    setBusy("checkout"); setMessage(""); setError(false);
    const { error } = await db.rpc("finalize_guest_checkout", { p_booking_id: summary.booking_id });
    if (error) { setError(true); setMessage(error.message); }
    else { setMessage("Checkout completed. Room " + summary.room_number + " has been sent to housekeeping."); try { await fetch("/api/notifications/booking", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookingId: summary.booking_id, event: "checked_out" }) }); } catch {} setBookings(v => v.filter(b => b.id !== summary.booking_id)); setSummary(null); setPayments([]); }
    setBusy("");
  }

  return <div className="space-y-5">
    <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr] print:hidden">
      <section className="rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft">
        <h2 className="font-semibold text-forest">Guests currently checked in</h2>
        <p className="mt-1 text-sm text-gray-500">Select a guest to prepare their folio and settle the account.</p>
        {!bookings.length ? <p className="py-8 text-center text-sm text-gray-500">No checked-in guests found.</p> : <div className="mt-4 space-y-2">{bookings.map(b => <button key={b.id} onClick={() => load(b.id)} disabled={!!busy} className={`w-full rounded-xl border p-4 text-left hover:border-leaf ${summary?.booking_id === b.id ? "border-leaf bg-emerald-50" : "border-[#EAE6DC]"}`}><span className="block font-semibold text-forest">{b.guest_name}</span><span className="mt-1 block text-xs text-gray-500">{b.guest_phone} · {b.check_in} to {b.check_out}</span><span className="mt-1 block break-all text-[10px] text-gray-400">Booking ref: {b.id}</span></button>)}</div>}
      </section>
      <section className="rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft">
        <div><p className="text-xs font-bold tracking-widest text-gold">GUEST FOLIO</p><h2 className="mt-1 text-xl font-semibold text-forest">Billing & checkout</h2><p className="mt-1 text-sm text-gray-500">Room charges, linked room-service orders, deposits and final settlement.</p></div>
        {message && <p role="status" className={`mt-4 rounded-xl p-3 text-sm ${error ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>{message}</p>}
        {!summary ? <p className="mt-8 rounded-xl bg-cream p-6 text-center text-sm text-gray-500">Choose a checked-in guest to view their bill.</p> : <div className="mt-5 space-y-4">
          <div className="rounded-xl bg-cream p-4"><div className="flex flex-wrap justify-between gap-2"><div><h3 className="font-semibold text-forest">{summary.guest_name}</h3><p className="text-xs text-gray-500">Room {summary.room_number} · {summary.nights} night(s)</p><p className="text-xs text-gray-500">{summary.check_in} to {summary.check_out}</p></div><span className="text-xs text-gray-500">{summary.booking_id.slice(0, 8)}</span></div></div>
          <div className="space-y-2">{summary.items.map(item => <div key={item.id} className="flex justify-between gap-3 border-b border-gray-100 py-2 text-sm"><div><p className="font-medium text-forest">{item.description}</p><p className="text-xs text-gray-500">{item.quantity} × {money(Number(item.unit_amount))}</p></div><b>{money(Number(item.total_amount))}</b></div>)}</div>
          <div className="space-y-2 rounded-xl border border-[#EAE6DC] p-4 text-sm"><div className="flex justify-between"><span>Total charges</span><b>{money(summary.charges)}</b></div><div className="flex justify-between"><span>Payments and deposits</span><b>{money(summary.paid)}</b></div><div className="flex justify-between border-t pt-2 text-base font-bold text-forest"><span>Outstanding balance</span><span>{money(summary.balance)}</span></div></div>
          <button onClick={() => window.print()} className="w-full rounded-xl border border-forest px-4 py-3 text-sm font-semibold text-forest hover:bg-cream">Print guest invoice</button>
          {summary.balance > 0 && <div className="space-y-3 rounded-xl bg-cream p-4"><h3 className="font-semibold text-forest">Receive payment</h3><div className="grid gap-2 sm:grid-cols-2"><input type="number" min="1" max={summary.balance} step="1" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount in UGX" className="min-w-0 rounded-lg border p-3 text-sm" /><select value={method} onChange={e => setMethod(e.target.value)} className="rounded-lg border p-3 text-sm"><option value="cash">Cash</option><option value="mobile_money">Mobile money</option><option value="card">Card</option><option value="bank_transfer">Bank transfer</option><option value="pesapal">Pesapal</option></select></div><input value={reference} onChange={e => setReference(e.target.value)} placeholder="Transaction reference (optional)" className="w-full rounded-lg border p-3 text-sm" /><button disabled={!!busy || !Number(amount) || Number(amount) > summary.balance} onClick={receive} className="w-full rounded-xl bg-forest px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">{busy === "pay" ? "Recording payment…" : "Record payment"}</button></div>}
          <button disabled={!!busy || summary.balance > 0} onClick={checkout} className="w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">{busy === "checkout" ? "Completing checkout…" : summary.balance > 0 ? "Settle balance to complete checkout" : "Complete guest checkout"}</button>
          <p className="text-xs text-gray-400">Checkout is blocked until the full folio balance is settled. The room is then marked dirty for housekeeping.</p>
        </div>}
      </section>
    </div>
    {summary && <article className="guest-invoice-print hidden bg-white p-8 text-slate-800 print:block">
      <header className="flex items-start justify-between gap-6 border-b-2 border-[#123B83] pb-5">
        <div><BrandLogo width={190} /><p className="mt-2 text-xs text-slate-500">{hotel.address}</p><p className="text-xs text-slate-500">Tel: {hotel.phone}</p></div>
        <div className="text-right"><p className="text-xs font-bold tracking-[0.2em] text-[#C18A36]">GUEST ACCOUNT</p><h1 className="mt-1 text-3xl font-bold text-[#123B83]">INVOICE</h1><p className="mt-2 text-sm">Issued: {dateTime(new Date().toISOString())}</p><p className="text-sm">Booking: {summary.booking_id.slice(0, 8).toUpperCase()}</p></div>
      </header>
      <section className="grid grid-cols-2 gap-8 py-6 text-sm"><div><p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Billed to</p><p className="font-bold">{summary.guest_name}</p><p>{summary.guest_phone}</p></div><div><p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Stay details</p><p>Room: <b>{summary.room_number}</b></p><p>Check-in: {date(summary.check_in)}</p><p>Check-out: {date(summary.check_out)}</p><p>Nights: {summary.nights}</p></div></section>
      <table className="w-full border-collapse text-sm"><thead><tr className="border-y border-slate-300 bg-slate-50 text-left"><th className="p-3">Description</th><th className="p-3 text-right">Qty</th><th className="p-3 text-right">Unit price</th><th className="p-3 text-right">Amount (UGX)</th></tr></thead><tbody>{summary.items.map(item => <tr key={item.id} className="border-b border-slate-200"><td className="p-3">{item.description}</td><td className="p-3 text-right">{item.quantity}</td><td className="p-3 text-right">{money(Number(item.unit_amount))}</td><td className="p-3 text-right font-medium">{money(Number(item.total_amount))}</td></tr>)}</tbody></table>
      <section className="ml-auto mt-5 w-full max-w-xs space-y-2 text-sm"><div className="flex justify-between"><span>Total charges</span><b>{money(summary.charges)}</b></div><div className="flex justify-between"><span>Payments received</span><b>{money(summary.paid)}</b></div><div className="flex justify-between border-t-2 border-[#123B83] pt-3 text-lg font-bold"><span>Balance due</span><span>{money(summary.balance)}</span></div></section>
      <section className="mt-8"><h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-600">Payment history</h2>{payments.length ? <table className="w-full border-collapse text-xs"><thead><tr className="border-y border-slate-300 text-left"><th className="p-2">Date</th><th className="p-2">Method</th><th className="p-2">Receipt / reference</th><th className="p-2 text-right">Amount</th></tr></thead><tbody>{payments.map(p => <tr key={p.id} className="border-b border-slate-200"><td className="p-2">{dateTime(p.created_at)}</td><td className="p-2">{(p.payment_method || "Online").replace(/_/g, " ")}</td><td className="p-2">{p.receipt_number || p.confirmation_code || "—"}</td><td className="p-2 text-right">{money(Number(p.amount))}</td></tr>)}</tbody></table> : <p className="text-sm text-slate-500">No completed payments recorded.</p>}</section>
      <footer className="mt-12 border-t border-slate-200 pt-5 text-center text-xs text-slate-500"><p className="font-semibold text-[#123B83]">Thank you for staying with {hotel.name}.</p><p className="mt-1">Please keep this invoice for your records. For questions, contact reception on {hotel.phone}.</p></footer>
    </article>}
  </div>;
}
