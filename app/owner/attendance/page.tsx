import { createClient } from "@/lib/supabase/server";
import { AttendanceRegister } from "@/components/attendance-register";

export const dynamic = "force-dynamic";

function validDate(value: string | undefined, today: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return today;
  const parsed = new Date(value + "T00:00:00Z");
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0,10) !== value ? today : value;
}

export default async function OwnerAttendancePage({ searchParams }: { searchParams: { date?: string } }) {
  const db = await createClient();
  const today = new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Kampala",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const selectedDate = validDate(searchParams.date,today);
  const start = new Date(selectedDate + "T00:00:00+03:00");
  const end = new Date(start.getTime() + 86400000);
  const [attendanceResult, profilesResult, shiftsResult] = await Promise.all([
    db.from("attendance").select("id,staff_id,clock_in,clock_out,status").gte("clock_in",start.toISOString()).lt("clock_in",end.toISOString()).order("clock_in"),
    db.from("profiles").select("id,full_name"),
    db.from("staff_shift_assignments").select("id,staff_id,shift_name,starts_at,ends_at").eq("status","scheduled").lt("starts_at",end.toISOString()).gt("ends_at",start.toISOString()).order("starts_at"),
  ]);
  const names = new Map((profilesResult.data || []).map((person: any) => [person.id,person.full_name]));
  const rows = (attendanceResult.data || []).map((row: any) => ({...row,staff_name:names.get(row.staff_id)||"Employee"}));
  const scheduledShifts = (shiftsResult.data || []).map((row: any) => ({...row,staff_name:names.get(row.staff_id)||"Employee"}));
  return <main className="space-y-6"><header><p className="text-xs font-bold tracking-widest text-gold">OWNER OFFICE</p><h1 className="mt-2 text-3xl font-semibold text-forest">Hotel-wide attendance</h1><p className="mt-2 text-sm text-gray-500">Daily clock records across all departments.</p></header>{attendanceResult.error||profilesResult.error||shiftsResult.error?<p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Attendance data could not be loaded. Check database access and attendance migration status.</p>:<AttendanceRegister rows={rows as any} scheduledShifts={scheduledShifts as any} selectedDate={selectedDate} scope="All departments" />}</main>;
}
