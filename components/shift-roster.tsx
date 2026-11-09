"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ReportExport } from "@/components/report-export";

type StaffOption = { id: string; full_name: string; department_id: string; department_name: string };
type DepartmentOption = { id: string; name: string };
type ShiftRow = {
  id: string; staff_id: string; staff_name: string; department_id: string;
  department_name: string; shift_name: string; starts_at: string; ends_at: string;
  status: string; cancellation_reason: string | null;
};

const dateTime = (value: string) => new Intl.DateTimeFormat("en-UG", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Kampala",
}).format(new Date(value));

export function ShiftRoster({ staff, departments, shifts, managerDepartmentId }: {
  staff: StaffOption[]; departments: DepartmentOption[]; shifts: ShiftRow[];
  managerDepartmentId?: string | null;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(shifts);
  const [staffId, setStaffId] = useState("");
  const [departmentId, setDepartmentId] = useState(managerDepartmentId || "");
  const [shiftName, setShiftName] = useState("Morning");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [cancelId, setCancelId] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  const visibleStaff = useMemo(
    () => staff.filter(person => !departmentId || person.department_id === departmentId),
    [staff, departmentId]
  );
  const visibleRows = useMemo(
    () => rows.filter(row => !departmentId || row.department_id === departmentId),
    [rows, departmentId]
  );
  const exportRows = [
    ["Buladde Palm Villa Hotel", "Staff shift roster"],
    ["All times", "Africa/Kampala"],
    [],
    ["Employee", "Department", "Shift", "Starts", "Ends", "Status"],
    ...visibleRows.map(row => [row.staff_name,row.department_name,row.shift_name,dateTime(row.starts_at),dateTime(row.ends_at),row.status]),
  ];

  async function createShift(event: React.FormEvent) {
    event.preventDefault();
    setBusy("create"); setMessage(""); setFailed(false);
    if (!staffId || !startsAt || !endsAt) {
      setFailed(true); setMessage("Choose an employee and both shift times."); setBusy(""); return;
    }
    const toIso = (value: string) => new Date(value + ":00+03:00").toISOString();
    const { error } = await createClient().rpc("create_staff_shift", {
      p_staff_id: staffId, p_shift_name: shiftName,
      p_starts_at: toIso(startsAt), p_ends_at: toIso(endsAt),
    });
    setBusy("");
    setFailed(!!error);
    setMessage(error?.message || "Shift added to the roster.");
    if (!error) { setStartsAt(""); setEndsAt(""); router.refresh(); }
  }

  async function cancelShift() {
    if (!cancelId) return;
    setBusy(cancelId); setMessage(""); setFailed(false);
    const { error } = await createClient().rpc("cancel_staff_shift", {
      p_shift_id: cancelId, p_reason: cancelReason,
    });
    setBusy(""); setFailed(!!error);
    setMessage(error?.message || "Shift cancelled.");
    if (!error) {
      setRows(current => current.map(row => row.id === cancelId
        ? { ...row, status: "cancelled", cancellation_reason: cancelReason } : row));
      setCancelId(""); setCancelReason(""); router.refresh();
    }
  }

  return (
    <div className="space-y-6">
      {message && <p role="status" className={`rounded-xl p-3 text-sm ${failed ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>{message}</p>}
      <section className="rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft">
        <div className="mb-4"><h2 className="font-semibold text-forest">Create a shift</h2><p className="mt-1 text-sm text-gray-500">Times are interpreted in Africa/Kampala. Overlapping shifts and approved leave are blocked.</p></div>
        <form onSubmit={createShift} className="grid gap-3 md:grid-cols-2">
          {!managerDepartmentId && <label className="grid gap-1 text-sm font-medium text-forest">Department
            <select value={departmentId} onChange={event => { setDepartmentId(event.target.value); setStaffId(""); }} className="rounded-xl border border-gray-200 px-3 py-3">
              <option value="">All departments</option>{departments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>}
          <label className="grid gap-1 text-sm font-medium text-forest">Employee
            <select required value={staffId} onChange={event => setStaffId(event.target.value)} className="rounded-xl border border-gray-200 px-3 py-3">
              <option value="">Select employee</option>{visibleStaff.map(person => <option key={person.id} value={person.id}>{person.full_name} · {person.department_name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium text-forest">Shift label
            <select value={shiftName} onChange={event => setShiftName(event.target.value)} className="rounded-xl border border-gray-200 px-3 py-3">
              <option>Morning</option><option>Afternoon</option><option>Night</option><option>Split shift</option><option>Custom</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium text-forest">Starts (Kampala)
            <input required type="datetime-local" value={startsAt} onChange={event => setStartsAt(event.target.value)} className="rounded-xl border border-gray-200 px-3 py-3" />
          </label>
          <label className="grid gap-1 text-sm font-medium text-forest">Ends (Kampala)
            <input required type="datetime-local" value={endsAt} onChange={event => setEndsAt(event.target.value)} className="rounded-xl border border-gray-200 px-3 py-3" />
          </label>
          <div className="flex items-end"><button disabled={!!busy || !visibleStaff.length} className="w-full rounded-xl bg-forest px-4 py-3 font-semibold text-white disabled:opacity-50">{busy === "create" ? "Saving…" : "Add to roster"}</button></div>
        </form>
      </section>

      <section className="overflow-hidden rounded-2xl border border-[#EAE6DC] bg-white shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#EAE6DC] p-5">
          <div><h2 className="font-semibold text-forest">Upcoming shifts</h2><p className="mt-1 text-xs text-gray-500">{visibleRows.length} record(s) loaded · next 30 days</p></div>
          <ReportExport rows={exportRows} filename="buladde-shift-roster.csv" />
        </div>
        {!visibleRows.length ? <p className="p-8 text-center text-sm text-gray-500">No shifts are scheduled in this view.</p> : <div className="overflow-x-auto">
          <table className="w-full min-w-[850px] text-left text-sm">
            <thead className="bg-[#F7F5EF] text-xs text-gray-500"><tr><th className="px-5 py-3">Employee</th><th className="px-5 py-3">Department</th><th className="px-5 py-3">Shift</th><th className="px-5 py-3">Starts</th><th className="px-5 py-3">Ends</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Action</th></tr></thead>
            <tbody>{visibleRows.map(row => <tr key={row.id} className="border-t border-gray-100">
              <td className="px-5 py-3 font-medium text-forest">{row.staff_name}</td><td className="px-5 py-3">{row.department_name}</td><td className="px-5 py-3">{row.shift_name}</td><td className="px-5 py-3">{dateTime(row.starts_at)}</td><td className="px-5 py-3">{dateTime(row.ends_at)}</td>
              <td className="px-5 py-3"><span className={row.status === "scheduled" ? "rounded-full bg-emerald-50 px-3 py-1 text-xs text-emerald-700" : "rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600"}>{row.status}</span></td>
              <td className="px-5 py-3">{row.status === "scheduled" && new Date(row.starts_at) > new Date() ? <button disabled={!!busy} onClick={() => {setCancelId(row.id);setCancelReason("");}} className="text-xs font-semibold text-red-700 underline">Cancel</button> : <span className="text-xs text-gray-400">—</span>}</td>
            </tr>)}</tbody>
          </table>
        </div>}
      </section>
      {cancelId && <section className="rounded-2xl border border-red-200 bg-white p-5">
        <h3 className="font-semibold text-forest">Cancel this shift</h3><p className="mt-1 text-sm text-gray-500">A reason is recorded in the audit history.</p>
        <div className="mt-3 flex flex-wrap gap-2"><input value={cancelReason} onChange={event => setCancelReason(event.target.value)} placeholder="Reason for cancellation" className="min-w-[220px] flex-1 rounded-xl border border-gray-200 px-3 py-3 text-sm" /><button disabled={!!busy || cancelReason.trim().length < 5} onClick={cancelShift} className="rounded-xl bg-red-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">{busy === cancelId ? "Saving…" : "Confirm cancellation"}</button><button onClick={() => setCancelId("")} className="rounded-xl border px-4 py-3 text-sm">Keep shift</button></div>
      </section>}
      <p className="text-xs text-gray-400">This roster does not automatically mark attendance, lateness, absence, overtime or payroll hours. Shift swaps require a separate approval workflow and are not enabled in this phase.</p>
    </div>
  );
}
