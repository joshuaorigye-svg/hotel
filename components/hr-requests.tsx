"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Staff = { staff_id: string; full_name: string; role: string; department_name: string };
type Advance = { id: string; staff_id: string; amount: number | string; repayment_per_month: number | string; reason: string; status: string; created_at: string; rejection_reason: string | null };
type Deduction = { id: string; staff_id: string; amount: number | string; reason: string; effective_month: string; status: string; created_at: string; rejection_reason: string | null };
type Repayment = { advance_id: string; amount: number | string; status: string };
const money = (value: number | string) => new Intl.NumberFormat("en-UG", { style: "currency", currency: "UGX", maximumFractionDigits: 0 }).format(Number(value) || 0);
const monthLabel = (value: string) => new Intl.DateTimeFormat("en-UG", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(value + "T00:00:00Z"));

export function HrRequests({ staff, advances, deductions, repayments, loadError = false }: {
  staff: Staff[]; advances: Advance[]; deductions: Deduction[]; repayments: Repayment[]; loadError?: boolean;
}) {
  const db = createClient(), router = useRouter();
  const [staffId, setStaffId] = useState(staff[0]?.staff_id || "");
  const [advanceAmount, setAdvanceAmount] = useState("");
  const [installment, setInstallment] = useState("");
  const [advanceReason, setAdvanceReason] = useState("");
  const [deductionAmount, setDeductionAmount] = useState("");
  const [deductionReason, setDeductionReason] = useState("");
  const [effectiveMonth, setEffectiveMonth] = useState(new Date().toISOString().slice(0, 7));
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const names = useMemo(() => new Map(staff.map(person => [person.staff_id, person.full_name])), [staff]);
  const balance = (advance: Advance) => Number(advance.amount) - repayments.filter(x => x.advance_id === advance.id).reduce((sum, x) => sum + Number(x.amount), 0);

  async function submitAdvance(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("advance"); setMessage("");
    const amount = Number(advanceAmount), monthly = Number(installment);
    if (!staffId || !Number.isFinite(amount) || amount <= 0 || !Number.isFinite(monthly) || monthly <= 0 || monthly > amount || advanceReason.trim().length < 5) {
      setMessage("Check the employee, amount, monthly repayment and reason. The repayment cannot exceed the advance."); setIsError(true); setBusy(""); return;
    }
    const { error } = await db.rpc("submit_staff_advance_request", { p_staff_id: staffId, p_amount: amount, p_repayment_per_month: monthly, p_reason: advanceReason.trim() });
    if (error) { setMessage(error.message); setIsError(true); }
    else { setMessage("Advance request submitted for owner approval."); setIsError(false); setAdvanceAmount(""); setInstallment(""); setAdvanceReason(""); router.refresh(); }
    setBusy("");
  }

  async function submitDeduction(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("deduction"); setMessage("");
    const amount = Number(deductionAmount), [year, month] = effectiveMonth.split("-").map(Number);
    const firstDay = new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10);
    if (!staffId || !Number.isFinite(amount) || amount <= 0 || deductionReason.trim().length < 5) {
      setMessage("Enter a valid employee, amount and reason."); setIsError(true); setBusy(""); return;
    }
    const { error } = await db.rpc("submit_salary_deduction_request", { p_staff_id: staffId, p_amount: amount, p_reason: deductionReason.trim(), p_effective_month: firstDay });
    if (error) { setMessage(error.message); setIsError(true); }
    else { setMessage("Deduction proposal submitted for owner approval."); setIsError(false); setDeductionAmount(""); setDeductionReason(""); router.refresh(); }
    setBusy("");
  }

  return (
    <div className="space-y-6">
      {loadError && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">HR request data is unavailable. Confirm migration 0014 has been reviewed and applied.</div>}
      {message && <div role="status" className={`rounded-xl border p-3 text-sm ${isError ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{message}</div>}
      <div className="grid gap-5 xl:grid-cols-2">
        <form onSubmit={submitAdvance} className="space-y-3 rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft">
          <div><h2 className="font-semibold text-forest">Request staff advance</h2><p className="mt-1 text-xs text-gray-500">Requests go to the owner. No advance is paid until the owner approves and records disbursement.</p></div>
          <label className="grid gap-1 text-sm">Employee<select value={staffId} onChange={e => setStaffId(e.target.value)} required className="rounded-lg border border-gray-200 px-3 py-2">{staff.map(person => <option key={person.staff_id} value={person.staff_id}>{person.full_name} · {person.department_name}</option>)}</select></label>
          <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm">Advance amount (UGX)<input type="number" min="1" step="1" required value={advanceAmount} onChange={e => setAdvanceAmount(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2" /></label><label className="grid gap-1 text-sm">Monthly repayment (UGX)<input type="number" min="1" step="1" required value={installment} onChange={e => setInstallment(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2" /></label></div>
          <label className="grid gap-1 text-sm">Reason<textarea required minLength={5} rows={3} value={advanceReason} onChange={e => setAdvanceReason(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2" placeholder="Record the reason for the request" /></label>
          <button disabled={!staff.length || !!busy} className="rounded-xl bg-forest px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy === "advance" ? "Submitting…" : "Submit advance request"}</button>
        </form>

        <form onSubmit={submitDeduction} className="space-y-3 rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft">
          <div><h2 className="font-semibold text-forest">Propose salary deduction</h2><p className="mt-1 text-xs text-gray-500">Use for documented, authorised deductions. Owner approval is required before it enters payroll.</p></div>
          <label className="grid gap-1 text-sm">Employee<select value={staffId} onChange={e => setStaffId(e.target.value)} required className="rounded-lg border border-gray-200 px-3 py-2">{staff.map(person => <option key={person.staff_id} value={person.staff_id}>{person.full_name} · {person.department_name}</option>)}</select></label>
          <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm">Deduction (UGX)<input type="number" min="1" step="1" required value={deductionAmount} onChange={e => setDeductionAmount(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2" /></label><label className="grid gap-1 text-sm">Payroll month<input type="month" required value={effectiveMonth} onChange={e => setEffectiveMonth(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2" /></label></div>
          <label className="grid gap-1 text-sm">Reason<textarea required minLength={5} rows={3} value={deductionReason} onChange={e => setDeductionReason(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2" placeholder="Reference the approved basis for the deduction" /></label>
          <button disabled={!staff.length || !!busy} className="rounded-xl bg-forest px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy === "deduction" ? "Submitting…" : "Submit deduction proposal"}</button>
        </form>
      </div>

      <section className="space-y-3">
        <div><h2 className="text-lg font-semibold text-forest">Advance register</h2><p className="mt-1 text-sm text-gray-500">Outstanding balance includes repayments already scheduled in unpaid payroll.</p></div>
        {!advances.length ? <p className="rounded-xl bg-white p-6 text-center text-sm text-gray-500">No advance requests yet.</p> : advances.map(item => <article key={item.id} className="rounded-xl border border-[#EAE6DC] bg-white p-4"><div className="flex flex-wrap justify-between gap-2"><div><p className="font-semibold text-forest">{names.get(item.staff_id) || "Employee"}</p><p className="mt-1 text-xs text-gray-500">{item.reason}</p></div><span className="h-fit rounded-full bg-cream px-3 py-1 text-xs capitalize">{item.status}</span></div><div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3"><p>Advance: <b>{money(item.amount)}</b></p><p>Monthly: <b>{money(item.repayment_per_month)}</b></p><p>Balance: <b>{money(balance(item))}</b></p></div>{item.rejection_reason && <p className="mt-2 text-xs text-rose-700">Owner note: {item.rejection_reason}</p>}</article>)}
      </section>

      <section className="space-y-3">
        <div><h2 className="text-lg font-semibold text-forest">Deduction proposals</h2><p className="mt-1 text-sm text-gray-500">Approved proposals are attached to the selected payroll month, then marked applied after salary payment.</p></div>
        {!deductions.length ? <p className="rounded-xl bg-white p-6 text-center text-sm text-gray-500">No deduction proposals yet.</p> : deductions.map(item => <article key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#EAE6DC] bg-white p-4"><div><p className="font-semibold text-forest">{names.get(item.staff_id) || "Employee"} · {money(item.amount)}</p><p className="mt-1 text-xs text-gray-500">{item.reason} · {monthLabel(item.effective_month)}</p>{item.rejection_reason && <p className="mt-1 text-xs text-rose-700">Owner note: {item.rejection_reason}</p>}</div><span className="rounded-full bg-cream px-3 py-1 text-xs capitalize">{item.status}</span></article>)}
      </section>
    </div>
  );
}
