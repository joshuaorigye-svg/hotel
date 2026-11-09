import { createClient } from "@/lib/supabase/server";
import { ReportExport } from "@/components/report-export";
import {
  BedDouble,
  CalendarDays,
  ClipboardCheck,
  Receipt,
  Users,
  Utensils,
  Wallet,
} from "lucide-react";

export const dynamic = "force-dynamic";

type Payment = { amount: number | string | null; created_at: string };
type Expense = { amount: number | string | null; created_at: string; department_id: string | null };
type StaffProfile = { department_id: string | null; departments?: { name: string } | { name: string }[] | null };
type Booking = { check_in: string; check_out: string };
type Attendance = { staff_id: string; status: string };
type Task = { status: string };
type Order = { total_amount: number | string | null };
type InventoryItem = { quantity: number | string | null; low_stock_threshold: number | string | null };

const money = (value: number) =>
  new Intl.NumberFormat("en-UG", {
    style: "currency",
    currency: "UGX",
    maximumFractionDigits: 0,
  }).format(value || 0);

const monthKey = (value: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Kampala",
    year: "numeric",
    month: "2-digit",
  }).format(new Date(value));

const monthLabel = (key: string) =>
  new Intl.DateTimeFormat("en-UG", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(key + "-01T00:00:00Z"));

function Metric({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ComponentType<{ size?: number }>;
}) {
  return (
    <article className="rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{label}</p>
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
          <Icon size={19} />
        </span>
      </div>
      <p className="mt-4 text-2xl font-semibold text-forest">{value}</p>
      <p className="mt-1 text-xs text-gray-400">{detail}</p>
    </article>
  );
}

export default async function Reports() {
  const db = await createClient();
  const now = new Date();
  const kampalaParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Kampala",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => kampalaParts.find((item) => item.type === type)?.value || "";
  const today = new Date(Date.UTC(Number(part("year")), Number(part("month")) - 1, Number(part("day"))));
  const todayKey = today.toISOString().slice(0, 10);
  const firstMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 11, 1));
  const from = firstMonth.toISOString();
  const fromDate = firstMonth.toISOString().slice(0, 10);
  const monthKeys = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(firstMonth.getUTCFullYear(), firstMonth.getUTCMonth() + index, 1));
    return date.toISOString().slice(0, 7);
  });

  const [payments, expenses, bookings, rooms, attendance, staff, tasks, orders, inventory] =
    await Promise.all([
      db.from("payments").select("amount,created_at").eq("status", "completed").gte("created_at", from).order("created_at"),
      db.from("expenses").select("amount,created_at,department_id").eq("approval_status", "approved").gte("created_at", from),
      db.from("bookings").select("check_in,check_out").in("status", ["confirmed", "checked_in", "checked_out"]).gte("check_out", fromDate).lte("check_in", todayKey),
      db.from("rooms").select("id").eq("is_active", true),
      db.from("attendance").select("staff_id,status").gte("clock_in", from),
      db.from("profiles").select("id,department_id,departments(name)").eq("is_active", true),
      db.from("tasks").select("status").gte("created_at", from),
      db.from("restaurant_orders").select("total_amount").gte("created_at", from).neq("status", "cancelled"),
      db.from("inventory_items").select("quantity,low_stock_threshold").eq("is_active", true),
    ]);

  const results = [payments, expenses, bookings, rooms, attendance, staff, tasks, orders, inventory];
  const hasErrors = results.some((result) => result.error);
  const paymentRows = (payments.data || []) as Payment[];
  const expenseRows = (expenses.data || []) as Expense[];
  const staffProfiles = (staff.data || []) as StaffProfile[];
  const bookingRows = (bookings.data || []) as Booking[];
  const roomCount = rooms.data?.length || 0;
  const attendanceRows = (attendance.data || []) as Attendance[];
  const taskRows = (tasks.data || []) as Task[];
  const orderRows = (orders.data || []) as Order[];
  const inventoryRows = (inventory.data || []) as InventoryItem[];

  const revenue = paymentRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const expensesTotal = expenseRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const monthly = monthKeys.map((key) => ({
    month: key,
    revenue: paymentRows.filter((row) => monthKey(row.created_at) === key).reduce((sum, row) => sum + Number(row.amount || 0), 0),
    expenses: expenseRows.filter((row) => monthKey(row.created_at) === key).reduce((sum, row) => sum + Number(row.amount || 0), 0),
  }));

  // Occupancy is a booking-date estimate using today's active room count. Future nights are excluded.
  const reportEnd = new Date(today);
  reportEnd.setUTCDate(reportEnd.getUTCDate() + 1);
  const roomNights = bookingRows.reduce((sum, booking) => {
    const checkIn = new Date(booking.check_in + "T00:00:00Z");
    const checkOut = new Date(booking.check_out + "T00:00:00Z");
    const start = checkIn > firstMonth ? checkIn : firstMonth;
    const end = checkOut < reportEnd ? checkOut : reportEnd;
    return sum + (end > start ? (end.getTime() - start.getTime()) / 86400000 : 0);
  }, 0);
  const elapsedDays = Math.floor((reportEnd.getTime() - firstMonth.getTime()) / 86400000);
  const availableRoomNights = elapsedDays * roomCount;
  const occupancy = availableRoomNights ? Math.min(100, (roomNights / availableRoomNights) * 100) : 0;

  const currentlyClockedIn = new Set(
    attendanceRows.filter((row) => row.status === "clocked_in").map((row) => row.staff_id),
  ).size;
  const completedTasks = taskRows.filter((row) => row.status === "done").length;
  const lowStock = inventoryRows.filter(
    (row) => Number(row.quantity || 0) <= Number(row.low_stock_threshold || 0),
  ).length;
  const departmentTotals = new Map<string, number>();
  for (const expense of expenseRows) {
    const profile = staffProfiles.find((row) => row.department_id === expense.department_id);
    const relation = profile?.departments;
    const departmentName = Array.isArray(relation) ? relation[0]?.name : relation?.name;
    const key = departmentName || "Unassigned";
    departmentTotals.set(key, (departmentTotals.get(key) || 0) + Number(expense.amount || 0));
  }

  const exportRows = [
    ["Monthly summary", "Revenue (UGX)", "Approved expenses (UGX)", "Net recorded movement (UGX)"],
    ...monthly.map((row) => [row.month, String(row.revenue), String(row.expenses), String(row.revenue - row.expenses)]),
    [],
    ["Operational summary", "Value"],
    ["Completed payments (UGX)", String(revenue)],
    ["Approved expenses (UGX)", String(expensesTotal)],
    ["Net recorded movement (UGX)", String(revenue - expensesTotal)],
    ["Estimated occupancy (%)", occupancy.toFixed(1)],
    ["Estimated room nights", String(roomNights)],
    ["Active rooms", String(roomCount)],
    ["Staff clocked in", String(currentlyClockedIn)],
    ["Completed tasks", String(completedTasks)],
    ["Restaurant and bar orders", String(orderRows.length)],
    ["Low-stock items", String(lowStock)],
  ];
  const maxBar = Math.max(1, ...monthly.flatMap((row) => [row.revenue, row.expenses]));

  return (
    <div className="space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gold">OWNER OFFICE</p>
          <h1 className="mt-1 text-2xl font-semibold text-forest md:text-3xl">Hotel performance reports</h1>
          <p className="mt-2 text-sm text-gray-500">A rolling 12-month view of recorded financial and operating activity.</p>
        </div>
        <ReportExport rows={exportRows} filename="buladde-hotel-performance-report.csv" />
      </header>

      {hasErrors && (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Some report sections could not be loaded. Check the applied database migrations and the relevant Supabase table permissions. Figures below include only records returned successfully.
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Completed payments" value={money(revenue)} detail="Completed payment records in period" icon={Wallet} />
        <Metric label="Approved expenses" value={money(expensesTotal)} detail="Approved expenses recorded in period" icon={Receipt} />
        <Metric label="Net recorded cash movement" value={money(revenue - expensesTotal)} detail="Payments less approved expenses, not audited profit" icon={CalendarDays} />
        <Metric label="Estimated room occupancy" value={occupancy.toFixed(1) + "%"} detail={roomCount + " active rooms; booking-date estimate"} icon={BedDouble} />
        <Metric label="Estimated room nights" value={roomNights.toLocaleString("en-UG", { maximumFractionDigits: 0 })} detail="Past booking nights in the reporting period" icon={BedDouble} />
        <Metric label="Staff clocked in" value={String(currentlyClockedIn)} detail={staffProfiles.length + " active staff accounts"} icon={Users} />
        <Metric label="Tasks completed" value={String(completedTasks)} detail="Tasks created during this reporting period" icon={ClipboardCheck} />
        <Metric label="Restaurant & bar orders" value={String(orderRows.length)} detail={money(orderRows.reduce((sum, row) => sum + Number(row.total_amount || 0), 0)) + " order value; not added to payments"} icon={Utensils} />
      </section>

      <section className="rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold text-forest">Monthly income and expenses</h2>
            <p className="mt-1 text-xs text-gray-500">Based on payment and expense recording dates</p>
          </div>
          <div className="flex gap-4 text-xs">
            <span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-sm bg-emerald-600" />Payments</span>
            <span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-sm bg-amber-500" />Expenses</span>
          </div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
          {monthly.map((row) => (
            <div key={row.month} className="min-w-0">
              <div className="mb-2 flex justify-between text-[11px] text-gray-500">
                <span>{monthLabel(row.month)}</span><span>{money(row.revenue)}</span>
              </div>
              <div className="flex h-24 items-end gap-1 rounded-lg bg-[#F7F5EF] px-2 pt-2">
                <div title={"Payments " + money(row.revenue)} className="min-w-1 flex-1 rounded-t bg-emerald-600" style={{ height: Math.max(row.revenue ? 3 : 0, (row.revenue / maxBar) * 100) + "%" }} />
                <div title={"Expenses " + money(row.expenses)} className="min-w-1 flex-1 rounded-t bg-amber-500" style={{ height: Math.max(row.expenses ? 3 : 0, (row.expenses / maxBar) * 100) + "%" }} />
              </div>
              <p className="mt-1 truncate text-[10px] text-gray-400">Expenses: {money(row.expenses)}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft">
          <h2 className="font-semibold text-forest">Approved expenses by department</h2>
          {departmentTotals.size === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">No approved expenses in this period.</p>
          ) : Array.from(departmentTotals.entries()).sort((a, b) => b[1] - a[1]).map(([name, value]) => (
            <div key={name} className="border-b py-3 last:border-0">
              <div className="mb-2 flex justify-between gap-3 text-sm"><span>{name}</span><b>{money(value)}</b></div>
              <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                <div className="h-full rounded-full bg-amber-500" style={{ width: Math.min(100, (value / Math.max(1, expensesTotal)) * 100) + "%" }} />
              </div>
            </div>
          ))}
        </section>
        <section className="rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft">
          <h2 className="font-semibold text-forest">Operational watchlist</h2>
          <div className="mt-3 divide-y text-sm">
            <div className="flex justify-between py-3"><span>Low-stock inventory items</span><b className={lowStock ? "text-rose-700" : "text-forest"}>{lowStock}</b></div>
            <div className="flex justify-between py-3"><span>Active hotel rooms</span><b>{roomCount}</b></div>
            <div className="flex justify-between py-3"><span>Bookings included in occupancy estimate</span><b>{bookingRows.length}</b></div>
            <div className="flex justify-between py-3"><span>Attendance records in period</span><b>{attendanceRows.length}</b></div>
            <div className="flex justify-between py-3"><span>Tasks created in period</span><b>{taskRows.length}</b></div>
            <div className="flex justify-between py-3"><span>Non-cancelled restaurant/bar orders</span><b>{orderRows.length}</b></div>
          </div>
          <p className="mt-3 text-xs text-gray-400">Occupancy uses today&apos;s active room count and past booking nights. It is an estimate, not a historical room-inventory snapshot.</p>
        </section>
      </div>
      <p className="text-xs text-gray-400">
        Reporting period: {monthLabel(monthKeys[0])} to {monthLabel(monthKeys[11])}. Payments are counted once from the payments table. Restaurant order value is shown separately to avoid double-counting collections. Net recorded cash movement is not a formal profit-and-loss statement.
      </p>
    </div>
  );
}
