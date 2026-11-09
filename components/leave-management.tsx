"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export type LeaveRequest = {
  id: string;
  staff_id: string;
  department_id: string | null;
  starts_on: string;
  ends_on: string;
  leave_type: string;
  reason: string | null;
  contact_phone: string | null;
  status: string;
  reviewed_at: string | null;
  decision_note: string | null;
  created_at: string;
  staff_name?: string;
  department_name?: string;
};

const moneylessDate = (value: string) => new Intl.DateTimeFormat("en-UG", {
  day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
}).format(new Date(value + "T00:00:00Z"));
const dayCount = (start: string, end: string) => Math.round((Date.parse(end + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) / 86400000) + 1;

export function LeaveManagement({ mode, requests }: { mode: "staff" | "review"; requests: LeaveRequest[] }) {
  const db = createClient();
  const router = useRouter();
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [leaveType, setLeaveType] = useState("annual");
  const [reason, setReason] = useState("");
  const [contact, setContact] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("submit"); setMessage("");
    if (!startsOn || !endsOn || endsOn < startsOn || reason.trim().length < 5) {
      setMessage("Check the dates and provide a reason of at least five characters.");
      setFailed(true); setBusy(""); return;
    }
    const { error } = await db.rpc("submit_staff_leave", {
      p_starts_on: startsOn, p_ends_on: endsOn, p_leave_type: leaveType,
      p_reason: reason.trim(), p_contact_phone: contact.trim() || null,
    });
    if (error) { setMessage(error.message); setFailed(true); }
    else {
      setMessage("Leave request submitted for review.");
      setFailed(false); setStartsOn(""); setEndsOn(""); setReason(""); setContact("");
      router.refresh();
    }
    setBusy("");
  }

  async function review(id: string, decision: "approve" | "reject") {
    const note = (notes[id] || "").trim();
    if (decision === "reject" && note.length < 5) {
      setMessage("Enter a clear reason before rejecting this request.");
      setFailed(true); return;
    }
    setBusy(id); setMessage("");
    const { error } = await db.rpc("review_staff_leave", {
      p_request_id: id, p_decision: decision, p_decision_note: note || null,
    });
    if (error) { setMessage(error.message); setFailed(true); }
    else { setMessage("Leave request " + (decision === "approve" ? "approved." : "rejected.")); setFailed(false); router.refresh(); }
    setBusy("");
  }

  async function cancel(id: string) {
    setBusy(id); setMessage("");
    const { error } = await db.rpc("cancel_staff_leave", { p_request_id: id });
    if (error) { setMessage(error.message); setFailed(true); }
    else { setMessage("Pending leave request cancelled."); setFailed(false); router.refresh(); }
    setBusy("");
  }

  const pending = requests.filter((item) => item.status === "pending");
  const history = requests.filter((item) => item.status !== "pending");
  const statusStyle = (status: string) => status === "approved" ? "bg-emerald-50 text-emerald-700" : status === "rejected" ? "bg-rose-50 text-rose-700" : status === "cancelled" ? "bg-gray-100 text-gray-600" : "bg-amber-50 text-amber-800";

  return (
    <div className="space-y-6">
      {message && <p role="status" className={`rounded-xl border p-3 text-sm ${failed ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{message}</p>}
      {mode === "staff" ? (
        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft">
          <div><h2 className="font-semibold text-forest">Request time off</h2><p className="mt-1 text-xs text-gray-500">Your department manager, HR or the owner will review your request. Overlapping pending or approved requests are not allowed.</p></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">Leave type
              <select value={leaveType} onChange={(e) => setLeaveType(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2">
                <option value="annual">Annual leave</option><option value="sick">Sick leave</option><option value="personal">Personal leave</option><option value="unpaid">Unpaid leave</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm">Contact number while away
              <input value={contact} onChange={(e) => setContact(e.target.value)} maxLength={30} className="rounded-lg border border-gray-200 px-3 py-2" placeholder="Optional" />
            </label>
            <label className="grid gap-1 text-sm">First day<input type="date" required value={startsOn} onChange={(e) => setStartsOn(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2" /></label>
            <label className="grid gap-1 text-sm">Last day<input type="date" required min={startsOn || undefined} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2" /></label>
          </div>
          {startsOn && endsOn && endsOn >= startsOn && <p className="text-xs text-gray-500">Duration: {dayCount(startsOn, endsOn)} calendar day(s). Weekend and public-holiday rules are not automatically deducted.</p>}
          <label className="grid gap-1 text-sm">Reason<textarea required minLength={5} maxLength={1000} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2" placeholder="Share the information your reviewer needs" /></label>
          <button disabled={!!busy} className="rounded-xl bg-forest px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy === "submit" ? "Submitting…" : "Submit leave request"}</button>
        </form>
      ) : (
        <section className="space-y-4">
          <div><h2 className="text-lg font-semibold text-forest">Requests awaiting review</h2><p className="mt-1 text-sm text-gray-500">Only the owner, HR manager or the employee&apos;s own department manager can decide a request. Employees cannot approve their own leave.</p></div>
          {!pending.length ? <p className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">No pending leave requests.</p> : pending.map((item) => (
            <article key={item.id} className="rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold text-forest">{item.staff_name || "Employee"}</h3><p className="mt-1 text-xs text-gray-500">{item.department_name || "Department"} · {item.leave_type.replace("_", " ")} · {dayCount(item.starts_on,item.ends_on)} day(s)</p><p className="mt-2 text-sm">{moneylessDate(item.starts_on)} to {moneylessDate(item.ends_on)}</p><p className="mt-2 text-sm text-gray-600">{item.reason}</p>{item.contact_phone && <p className="mt-2 text-xs text-gray-500">Contact while away: {item.contact_phone}</p>}</div><span className={`rounded-full px-3 py-1 text-xs capitalize ${statusStyle(item.status)}`}>Pending</span></div>
              <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-end"><label className="grid gap-1 text-xs text-gray-500">Decision note
                <input value={notes[item.id] || ""} onChange={(e) => setNotes((old) => ({ ...old, [item.id]: e.target.value }))} maxLength={500} placeholder="Required when rejecting" className="rounded-lg border border-gray-200 px-3 py-2 text-sm" />
              </label><button onClick={() => review(item.id,"approve")} disabled={!!busy} className="rounded-lg bg-forest px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy === item.id ? "Saving…" : "Approve"}</button><button onClick={() => review(item.id,"reject")} disabled={!!busy} className="rounded-lg border border-rose-200 px-4 py-2.5 text-sm font-semibold text-rose-700 disabled:opacity-50">Reject</button></div>
            </article>
          ))}
        </section>
      )}

      <section className="space-y-3">
        <div><h2 className="text-lg font-semibold text-forest">{mode === "staff" ? "My leave history" : "Recent leave decisions"}</h2><p className="mt-1 text-sm text-gray-500">Requests and decisions remain available for audit.</p></div>
        {!history.length ? <p className="rounded-xl bg-white p-6 text-center text-sm text-gray-500">No previous leave decisions.</p> : history.map((item) => (
          <article key={item.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-[#EAE6DC] bg-white p-4">
            <div><p className="font-semibold text-forest">{mode === "review" ? item.staff_name || "Employee" : item.leave_type.replace("_"," ")}</p><p className="mt-1 text-sm text-gray-600">{moneylessDate(item.starts_on)} to {moneylessDate(item.ends_on)} · {dayCount(item.starts_on,item.ends_on)} day(s)</p><p className="mt-1 text-xs text-gray-500">{item.reason}</p>{item.decision_note && <p className="mt-2 text-xs text-gray-500">Reviewer note: {item.decision_note}</p>}</div>
            <span className={`rounded-full px-3 py-1 text-xs capitalize ${statusStyle(item.status)}`}>{item.status}</span>
          </article>
        ))}
        {mode === "staff" && pending.map((item) => (
          <article key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-100 bg-white p-4">
            <div><p className="font-semibold text-forest">{item.leave_type.replace("_"," ")}</p><p className="mt-1 text-sm text-gray-600">{moneylessDate(item.starts_on)} to {moneylessDate(item.ends_on)}</p><p className="mt-1 text-xs text-gray-500">Awaiting review</p></div>
            <button onClick={() => cancel(item.id)} disabled={!!busy} className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 disabled:opacity-50">{busy === item.id ? "Cancelling…" : "Cancel request"}</button>
          </article>
        ))}
      </section>
      <p className="text-xs text-gray-400">This is a leave-request register. It does not calculate statutory leave balances or determine public-holiday and weekend entitlement rules.</p>
    </div>
  );
}
