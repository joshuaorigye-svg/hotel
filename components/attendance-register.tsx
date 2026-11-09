"use client";

import { ReportExport } from "@/components/report-export";

export type AttendanceRow = {
  id: string;
  staff_id: string;
  clock_in: string;
  clock_out: string | null;
  status: string;
  staff_name: string;
};

const dateLabel = (value: string) => new Intl.DateTimeFormat("en-UG", {
  day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Kampala",
}).format(new Date(value + "T00:00:00+03:00"));
const timeLabel = (value: string | null) => value
  ? new Intl.DateTimeFormat("en-UG", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Kampala" }).format(new Date(value))
  : "Still clocked in";
const duration = (start: string, end: string | null) => {
  if (!end) return "In progress";
  const minutes = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000));
  return Math.floor(minutes / 60) + "h " + String(minutes % 60).padStart(2, "0") + "m";
};

export function AttendanceRegister({ rows, selectedDate, scope }: {
  rows: AttendanceRow[]; selectedDate: string; scope: string;
}) {
  const open = rows.filter((row) => !row.clock_out);
  const completed = rows.filter((row) => !!row.clock_out);
  const totalMinutes = completed.reduce((sum, row) => sum + Math.max(0, (new Date(row.clock_out!).getTime() - new Date(row.clock_in).getTime()) / 60000), 0);
  const exportRows = [
    ["Buladde Palm Villa Hotel", "Daily attendance register", selectedDate],
    ["Scope", scope],
    [],
    ["Employee", "Clock in (Kampala)", "Clock out (Kampala)", "Duration", "Status"],
    ...rows.map((row) => [
      row.staff_name,
      new Date(row.clock_in).toLocaleString("en-UG", { timeZone: "Africa/Kampala" }),
      row.clock_out ? new Date(row.clock_out).toLocaleString("en-UG", { timeZone: "Africa/Kampala" }) : "",
      duration(row.clock_in, row.clock_out),
      row.status,
    ]),
  ];

  return (
    <div className="space-y-5">
      <form method="get" className="flex flex-wrap items-end gap-3 rounded-2xl border border-[#EAE6DC] bg-white p-4">
        <label className="grid gap-1 text-sm font-medium text-forest">Attendance date
          <input type="date" name="date" defaultValue={selectedDate} className="rounded-lg border border-gray-200 px-3 py-2" />
        </label>
        <button className="rounded-lg bg-forest px-4 py-2.5 text-sm font-semibold text-white">View date</button>
        <span className="text-xs text-gray-400">All times are shown in Africa/Kampala.</span>
      </form>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-2xl border border-[#EAE6DC] bg-white p-4"><p className="text-xs text-gray-500">Clock-in records</p><p className="mt-2 text-2xl font-semibold text-forest">{rows.length}</p></article>
        <article className="rounded-2xl border border-[#EAE6DC] bg-white p-4"><p className="text-xs text-gray-500">Completed shifts</p><p className="mt-2 text-2xl font-semibold text-emerald-700">{completed.length}</p></article>
        <article className="rounded-2xl border border-[#EAE6DC] bg-white p-4"><p className="text-xs text-gray-500">Still clocked in</p><p className="mt-2 text-2xl font-semibold text-amber-700">{open.length}</p></article>
        <article className="rounded-2xl border border-[#EAE6DC] bg-white p-4"><p className="text-xs text-gray-500">Recorded completed hours</p><p className="mt-2 text-2xl font-semibold text-forest">{Math.floor(totalMinutes / 60)}h {Math.round(totalMinutes % 60)}m</p></article>
      </section>

      <section className="overflow-hidden rounded-2xl border border-[#EAE6DC] bg-white shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#EAE6DC] p-5">
          <div><h2 className="font-semibold text-forest">Attendance register · {dateLabel(selectedDate)}</h2><p className="mt-1 text-xs text-gray-500">{scope} · {rows.length} clock-in record(s)</p></div>
          <ReportExport rows={exportRows} filename={"buladde-attendance-" + selectedDate + ".csv"} />
        </div>
        {!rows.length ? <p className="p-8 text-center text-sm text-gray-500">No clock-in records were found for this date.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="bg-[#F7F5EF] text-xs text-gray-500"><tr><th className="px-5 py-3">Employee</th><th className="px-5 py-3">Clock in</th><th className="px-5 py-3">Clock out</th><th className="px-5 py-3">Duration</th><th className="px-5 py-3">Status</th></tr></thead>
              <tbody>{rows.map((row) => <tr key={row.id} className="border-t border-gray-100"><td className="px-5 py-3 font-medium text-forest">{row.staff_name}</td><td className="px-5 py-3">{timeLabel(row.clock_in)}</td><td className="px-5 py-3">{timeLabel(row.clock_out)}</td><td className="px-5 py-3">{duration(row.clock_in,row.clock_out)}</td><td className="px-5 py-3"><span className={row.clock_out ? "rounded-full bg-emerald-50 px-3 py-1 text-xs text-emerald-700" : "rounded-full bg-amber-50 px-3 py-1 text-xs text-amber-800"}>{row.clock_out ? "Completed" : "Open shift"}</span></td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>
      <p className="text-xs text-gray-400">This register reports clock-in and clock-out events only. It does not infer absences, lateness, breaks, overtime or payroll hours, and it does not permit managers to edit attendance records.</p>
    </div>
  );
}
