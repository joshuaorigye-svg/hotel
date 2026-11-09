"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Staff = { id: string; full_name: string; role: string; salary: { base_salary: number | string; allowances: number | string; default_deductions: number | string; effective_from: string } | null };
type Item = { id: string; staff_id: string; base_salary: number | string; allowances: number | string; deductions: number | string; advance_deductions?: number | string; other_deductions?: number | string; net_pay: number | string; payment_status: string; payment_method: string | null; payment_reference: string | null; staff?: { full_name: string } };
type Run = { id: string; period_start: string; period_end: string; status: string; total_gross: number | string; total_deductions: number | string; total_net: number | string; cancellation_reason?: string | null; items: Item[] };
const money = (value: number | string) => new Intl.NumberFormat("en-UG", { style: "currency", currency: "UGX", maximumFractionDigits: 0 }).format(Number(value) || 0);

export function PayrollControls({ staff, runs, migrationError = false }: { staff: Staff[]; runs: Run[]; migrationError?: boolean }) {
  const db = createClient();
  const router = useRouter();
  const [staffId, setStaffId] = useState(staff[0]?.id || "");
  const [baseSalary, setBaseSalary] = useState("");
  const [allowances, setAllowances] = useState("0");
  const [deductions, setDeductions] = useState("0");
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [notes, setNotes] = useState("");
  const [references, setReferences] = useState<Record<string, string>>({});
  const [methods, setMethods] = useState<Record<string, string>>({});
  const [cancellationReasons, setCancellationReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  const selectedStaff = useMemo(() => staff.find((person) => person.id === staffId), [staff, staffId]);
  const reviewByRun = useMemo(() => {
    const result: Record<string, { errors: string[]; gross: number; deductions: number; net: number }> = {};
    for (const run of runs) {
      const errors: string[] = [];
      let gross = 0, totalDeductions = 0, net = 0;
      if (!run.items.length) errors.push("This payroll has no employee entries.");
      for (const item of run.items) {
        const base = Number(item.base_salary), extra = Number(item.allowances);
        const deduction = Number(item.deductions), takeHome = Number(item.net_pay);
        const advance = Number(item.advance_deductions || 0), other = Number(item.other_deductions || 0);
        if (![base, extra, deduction, takeHome, advance, other].every(Number.isFinite)) { errors.push("At least one employee has a missing or invalid amount."); continue; }
        if (base <= 0 || extra < 0 || deduction < 0 || takeHome < 0 || advance < 0 || other < 0) errors.push("At least one employee has a negative amount or zero base salary.");
        if (base + extra + 0.01 < deduction || Math.abs(base + extra - deduction - takeHome) > 0.01) errors.push("At least one employee gross, deductions and net pay do not balance.");
        if (advance + other - deduction > 0.01) errors.push("Advance and other deductions exceed total deductions for an employee.");
        if (run.status === "draft" && item.payment_status !== "pending") errors.push("A draft contains a salary already marked as paid.");
        gross += base + extra; totalDeductions += deduction; net += takeHome;
      }
      if (Math.abs(gross - Number(run.total_gross)) > 0.01 || Math.abs(totalDeductions - Number(run.total_deductions)) > 0.01 || Math.abs(net - Number(run.total_net)) > 0.01) errors.push("Payroll summary totals do not match employee entries.");
      result[run.id] = { errors: [...new Set(errors)], gross, deductions: totalDeductions, net };
    }
    return result;
  }, [runs]);
  const feedback = (text: string, error = false) => { setMessage(text); setIsError(error); };

  async function saveSalary(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("salary"); feedback("");
    const base = Number(baseSalary), extra = Number(allowances), deduction = Number(deductions);
    if (![base, extra, deduction].every(Number.isFinite) || base <= 0 || extra < 0 || deduction < 0 || base + extra < deduction) {
      feedback("Enter valid salary amounts. Deductions cannot exceed salary plus allowances.", true); setBusy(""); return;
    }
    const { error } = await db.rpc("save_staff_salary", {
      p_staff_id: staffId, p_base_salary: base, p_allowances: extra,
      p_default_deductions: deduction, p_effective_from: effectiveFrom,
    });
    if (error) feedback(error.message, true);
    else { feedback("Salary settings saved. Existing payroll runs are not changed."); setBaseSalary(""); router.refresh(); }
    setBusy("");
  }

  async function createRun(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("run"); feedback("");
    const [year, month] = period.split("-").map(Number);
    const start = new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10);
    const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    const { error } = await db.rpc("create_payroll_run", { p_period_start: start, p_period_end: end, p_notes: notes || null });
    if (error) feedback(error.message, true);
    else { feedback("Draft payroll prepared from the salary settings effective for that month."); setNotes(""); router.refresh(); }
    setBusy("");
  }

  async function approveRun(runId: string) {
    const review = reviewByRun[runId];
    if (review?.errors.length) { feedback("Payroll cannot be approved until review issues are corrected.", true); return; }
    setBusy(runId); feedback("");
    const { error } = await db.rpc("approve_payroll_run", { p_payroll_run_id: runId });
    if (error) feedback(error.message, true);
    else { feedback("Payroll approved. You can now record completed salary payments."); router.refresh(); }
    setBusy("");
  }

  async function recordPayment(itemId: string) {
    setBusy(itemId); feedback("");
    const reference = (references[itemId] || "").trim();
    const { error } = await db.rpc("record_payroll_payment", {
      p_payroll_item_id: itemId,
      p_payment_method: methods[itemId] || "mobile_money",
      p_payment_reference: reference,
    });
    if (error) feedback(error.message, true);
    else { feedback("Payment recorded. Only mark a salary paid after the money has actually been sent."); router.refresh(); }
    setBusy("");
  }

  async function cancelDraft(runId: string) {
    const reason = (cancellationReasons[runId] || "").trim();
    if (reason.length < 5) { feedback("Enter a cancellation reason of at least five characters.", true); return; }
    if (!window.confirm("Cancel this draft payroll? Scheduled advance repayments and salary deductions will be released so the month can be prepared again.")) return;
    setBusy(runId); feedback("");
    const { error } = await db.rpc("cancel_draft_payroll_run", {
      p_payroll_run_id: runId,
      p_reason: reason,
    });
    if (error) feedback(error.message, true);
    else { feedback("Draft cancelled. Reserved advance repayments and deductions have been released."); router.refresh(); }
    setBusy("");
  }

  return (
    <div className="space-y-6">
      {migrationError && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Payroll tables are not available yet. Review and apply migrations 0013 and 0014 in Supabase before using this module.</div>}
      {message && <div role="status" className={`rounded-xl border p-3 text-sm ${isError ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{message}</div>}

      <section className="grid gap-5 xl:grid-cols-2">
        <form onSubmit={saveSalary} className="space-y-3 rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft">
          <div><h2 className="font-semibold text-forest">Salary settings</h2><p className="mt-1 text-xs text-gray-500">Private owner records. Changes apply to future payroll runs only.</p></div>
          <label className="grid gap-1 text-sm">Staff member<select required value={staffId} onChange={(e) => { setStaffId(e.target.value); setBaseSalary(""); }} className="rounded-lg border border-gray-200 px-3 py-2">{staff.map((person) => <option key={person.id} value={person.id}>{person.full_name} · {person.role}</option>)}</select></label>
          {selectedStaff?.salary && <p className="rounded-lg bg-[#F7F5EF] p-3 text-xs text-gray-600">Current base: {money(selectedStaff.salary.base_salary)} · Allowances: {money(selectedStaff.salary.allowances)} · Deductions: {money(selectedStaff.salary.default_deductions)}</p>}
          <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm">Base salary (UGX)<input required type="number" min="1" step="1" value={baseSalary} onChange={(e) => setBaseSalary(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2" placeholder="e.g. 500000" /></label><label className="grid gap-1 text-sm">Allowances (UGX)<input type="number" min="0" step="1" value={allowances} onChange={(e) => setAllowances(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2" /></label><label className="grid gap-1 text-sm">Default deductions (UGX)<input type="number" min="0" step="1" value={deductions} onChange={(e) => setDeductions(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2" /></label><label className="grid gap-1 text-sm">Effective from<input required type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2" /></label></div>
          <button disabled={!staff.length || !!busy} className="rounded-xl bg-forest px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy === "salary" ? "Saving…" : "Save salary settings"}</button>
        </form>

        <form onSubmit={createRun} className="space-y-3 rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft">
          <div><h2 className="font-semibold text-forest">Prepare monthly payroll</h2><p className="mt-1 text-xs text-gray-500">Creates a draft snapshot. It does not send money or mark expenses paid.</p></div>
          <label className="grid gap-1 text-sm">Payroll month<input required type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2" /></label>
          <label className="grid gap-1 text-sm">Notes (optional)<textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="rounded-lg border border-gray-200 px-3 py-2" placeholder="Payroll notes or context" /></label>
          <button disabled={!!busy} className="rounded-xl bg-forest px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy === "run" ? "Preparing…" : "Create draft payroll"}</button>
        </form>
      </section>

      <section className="space-y-4">
        <div><h2 className="text-lg font-semibold text-forest">Payroll history</h2><p className="mt-1 text-sm text-gray-500">Approve each draft before recording any payment.</p></div>
        {!runs.length ? <div className="rounded-2xl border border-[#EAE6DC] bg-white p-8 text-center text-sm text-gray-500">No payroll runs yet. Save salary settings, then prepare a month.</div> : runs.map((run) => (
          <article key={run.id} className="rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold text-forest">{new Intl.DateTimeFormat("en-UG", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(run.period_start + "T00:00:00Z"))}</h3><p className="mt-1 text-xs text-gray-500">{run.items.length} staff · Gross {money(run.total_gross)} · Deductions {money(run.total_deductions)} · Net {money(run.total_net)}</p></div><span className="rounded-full bg-[#F7F5EF] px-3 py-1 text-xs capitalize text-forest">{run.status.replace("_", " ")}</span></div>
            {run.status === "draft" && <div className="mt-4 rounded-xl border border-gray-200 p-4">
              <div className={reviewByRun[run.id]?.errors.length ? "rounded-lg bg-red-50 p-3 text-red-800" : "rounded-lg bg-emerald-50 p-3 text-emerald-800"}>
                <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold">{reviewByRun[run.id]?.errors.length ? "Review needs attention" : "Payroll figures balanced"}</p><span className="text-xs">{reviewByRun[run.id]?.errors.length || 0} issue(s)</span></div>
                {reviewByRun[run.id]?.errors.length ? <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">{reviewByRun[run.id].errors.map((issue, index) => <li key={index}>{issue}</li>)}</ul> : <p className="mt-1 text-xs">All {run.items.length} employee entries balance, deduction breakdowns are consistent, and run totals match.</p>}
                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3"><p>Gross checked: <strong>{money(reviewByRun[run.id]?.gross || 0)}</strong></p><p>Deductions checked: <strong>{money(reviewByRun[run.id]?.deductions || 0)}</strong></p><p>Net checked: <strong>{money(reviewByRun[run.id]?.net || 0)}</strong></p></div>
              </div>
            </div>}
            {run.status === "draft" && <div className="mt-4 grid gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
              <label className="grid gap-1 text-xs font-medium text-gray-700">Cancellation reason
                <input value={cancellationReasons[run.id] || ""} onChange={(e) => setCancellationReasons((old) => ({ ...old, [run.id]: e.target.value }))} minLength={5} maxLength={500} placeholder="e.g. Incorrect staff or salary figures" className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm" />
              </label>
              <button onClick={() => cancelDraft(run.id)} disabled={!!busy || (cancellationReasons[run.id] || "").trim().length < 5} className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 disabled:opacity-50">{busy === run.id ? "Cancelling…" : "Cancel draft"}</button>
              <button onClick={() => approveRun(run.id)} disabled={!!busy || !!reviewByRun[run.id]?.errors.length} title={reviewByRun[run.id]?.errors.length ? "Resolve payroll review issues before approval" : "Approve reviewed payroll"} className="rounded-lg bg-forest px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy === run.id ? "Working…" : "Approve payroll"}</button>
            </div>}
            {run.status === "cancelled" && <p className="mt-3 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">Cancelled {run.cancellation_reason ? `· ${run.cancellation_reason}` : ""}. You can prepare this month again.</p>}
            <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="text-xs text-gray-500"><tr className="border-b"><th className="py-2 pr-3">Staff member</th><th className="py-2 pr-3">Base</th><th className="py-2 pr-3">Allowances</th><th className="py-2 pr-3">Deductions</th><th className="py-2 pr-3">Net pay</th><th className="py-2">Payment</th></tr></thead><tbody>{run.items.map((item) => <tr key={item.id} className="border-b border-gray-100 last:border-0"><td className="py-3 pr-3 font-medium">{item.staff?.full_name || "Staff member"}</td><td className="py-3 pr-3">{money(item.base_salary)}</td><td className="py-3 pr-3">{money(item.allowances)}</td><td className="py-3 pr-3">{money(item.deductions)}<p className="mt-1 text-[10px] text-gray-400">Advance {money(item.advance_deductions || 0)} · Other {money(item.other_deductions || 0)}</p></td><td className="py-3 pr-3 font-semibold">{money(item.net_pay)}</td><td className="py-3">{item.payment_status === "paid" ? <span className="text-emerald-700">Paid · {item.payment_reference}</span> : run.status !== "draft" ? <div className="flex min-w-52 gap-2"><select aria-label="Payment method" value={methods[item.id] || "mobile_money"} onChange={(e) => setMethods((old) => ({ ...old, [item.id]: e.target.value }))} className="w-28 rounded border px-2 py-1 text-xs"><option value="mobile_money">Mobile money</option><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option></select><input aria-label="Payment reference" value={references[item.id] || ""} onChange={(e) => setReferences((old) => ({ ...old, [item.id]: e.target.value }))} placeholder="Receipt ref" className="w-28 rounded border px-2 py-1 text-xs" /><button onClick={() => recordPayment(item.id)} disabled={!!busy} className="rounded bg-forest px-2 py-1 text-xs text-white disabled:opacity-50">{busy === item.id ? "…" : "Record"}</button></div> : <span className="text-gray-400">Awaiting approval</span>}</td></tr>)}</tbody></table></div>
          </article>
        ))}
      </section>
      <p className="text-xs text-gray-400">Payroll records are separate from expense cash-outs until each salary payment is actually completed and recorded. This is a payroll control register, not a tax calculation or statutory payroll filing system.</p>
    </div>
  );
}
