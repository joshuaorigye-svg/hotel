"use client";
import Link from "next/link";
import { useState } from "react";
import { hotel } from "@/config/hotel";
import { BrandMark } from "@/components/brand";

export default function Contact() {
  const [v, setV] = useState({ name: "", phone: "", email: "", message: "" });
  const [notice, setNotice] = useState(""), [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setNotice(""); setFailed(false);
    try {
      const response = await fetch("/api/public/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Message could not be sent.");
      setNotice(result.message); setV({ name: "", phone: "", email: "", message: "" });
    } catch (e) { setFailed(true); setNotice(e instanceof Error ? e.message : "Please call reception."); }
    finally { setBusy(false); }
  }
  return <main className="min-h-screen bg-cream"><header className="bg-white px-5 py-3"><Link href="/" className="flex items-center gap-3 font-semibold text-forest"><BrandMark size={48} /><span>{hotel.name}</span></Link></header>
    <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 md:grid-cols-2"><section><p className="text-xs font-bold tracking-widest text-gold">WE ARE HERE TO HELP</p><h1 className="mt-2 text-3xl font-semibold text-forest">Contact reception</h1><p className="mt-4 text-sm leading-7 text-gray-500">Call or WhatsApp us for room availability, events and general enquiries.</p><a className="mt-6 block text-lg font-semibold text-forest" href={`tel:${hotel.phone}`}>{hotel.phone}</a><a className="mt-2 inline-block text-sm font-semibold text-leaf" href={`https://wa.me/${hotel.whatsapp}`}>Chat on WhatsApp</a><p className="mt-6 text-sm text-gray-500">{hotel.address}</p><iframe title="Hotel location" src="https://www.google.com/maps?q=Buladde+Palm+Villa+Hotel+Gayaza+Road&output=embed" className="mt-6 h-72 w-full rounded-2xl border-0" loading="lazy" /></section>
      <form onSubmit={submit} className="h-fit space-y-4 rounded-2xl bg-white p-6 shadow-soft"><h2 className="font-semibold text-forest">Send a message</h2>{(["name", "phone", "email", "message"] as const).map(k => <label key={k} className="block text-sm capitalize">{k === "email" ? "Email (optional)" : k}{k === "message" ? <textarea required rows={4} value={v[k]} onChange={e => setV(s => ({ ...s, [k]: e.target.value }))} className="mt-2 w-full rounded-xl border p-3" /> : <input required={k !== "email"} type={k === "email" ? "email" : "text"} value={v[k]} onChange={e => setV(s => ({ ...s, [k]: e.target.value }))} className="mt-2 w-full rounded-xl border p-3" />}</label>)}{notice && <p role="status" className={`rounded-lg p-3 text-sm ${failed ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>{notice}</p>}<button disabled={busy} className="w-full rounded-xl bg-forest px-5 py-3 font-semibold text-white">{busy ? "Sending…" : "Send to reception"}</button></form>
    </div></main>;
}
