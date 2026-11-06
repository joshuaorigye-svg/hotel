"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole, LoaderCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { hotel } from "@/config/hotel";
import { BrandLogo } from "@/components/brand";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    const supabase = createClient();
    const { data: auth, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !auth.user) { setError("Sign in failed. Check your email and password."); setBusy(false); return; }
    const { data } = await supabase.from("profiles").select("role").eq("id", auth.user.id).single();
    router.replace(data?.role === "owner" ? "/owner/dashboard" : data?.role === "manager" ? "/manager/dashboard" : "/staff/tasks");
    router.refresh();
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_top_left,_#2D6A4F,_#173F32_55%,_#102B23)] px-4 py-10">
      <div className="w-full max-w-md rounded-3xl bg-white p-7 shadow-2xl sm:p-10">
        <div className="mx-auto mb-5 flex justify-center rounded-2xl bg-white p-2"><BrandLogo width={190} /></div>
        <p className="text-center text-xs font-bold tracking-[.22em] text-gold">STAFF PORTAL</p>
        <h1 className="mt-2 text-center text-2xl font-semibold text-forest">{hotel.shortName}</h1>
        <p className="mt-2 text-center text-sm text-gray-500">Sign in to your hotel workspace</p>
        <form onSubmit={submit} className="mt-8 space-y-4">
          <label className="block text-sm font-medium">Work email<input required type="email" value={email} onChange={e => setEmail(e.target.value)} className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-3 outline-none focus:border-leaf" /></label>
          <label className="block text-sm font-medium">Password<input required type="password" value={password} onChange={e => setPassword(e.target.value)} className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-3 outline-none focus:border-leaf" /></label>
          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-forest px-4 py-3.5 font-semibold text-white disabled:opacity-60">{busy ? <LoaderCircle className="animate-spin" /> : <LockKeyhole />}{busy ? "Signing in..." : "Sign in securely"}</button>
        </form>
        <p className="mt-6 text-center text-xs text-gray-400">Access is provided by your hotel administrator.</p>
      </div>
    </main>
  );
}
