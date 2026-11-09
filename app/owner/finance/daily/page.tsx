import { createClient } from "@/lib/supabase/server";
import { ReportExport } from "@/components/report-export";

export const dynamic = "force-dynamic";

type Payment = { amount: number | string | null; payment_method: string | null; status: string; created_at: string };
type Expense = { id: string; title: string; amount: number | string | null; payment_status: string; paid_at: string | null; created_at: string };
type Refund = { id: string; amount: number | string | null; processed_at: string | null; refund_reference: string | null };
type PayrollPayment = { id: string; net_pay: number | string | null; paid_at: string | null; payment_reference: string | null };
type AdvanceDisbursement = { id: string; amount: number | string | null; disbursed_at: string | null };
type Session = { id: string; cashier_id: string; opening_float: number | string; cash_sales: number | string | null; non_cash_sales: number | string | null; cash_expenses: number | string | null; expected_cash: number | string | null; closing_cash: number | string | null; cash_variance: number | string | null; status: string; opened_at: string; closed_at: string | null };

const money = (value: number) => new Intl.NumberFormat("en-UG", {
  style: "currency", currency: "UGX", maximumFractionDigits: 0,
}).format(value || 0);

function kampalaDate(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Kampala", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (key: string) => parts.find((part) => part.type === key)?.value || "";
  return get("year") + "-" + get("month") + "-" + get("day");
}

function dayBounds(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  const nextDate = next.toISOString().slice(0, 10);
  return {
    start: date + "T00:00:00+03:00",
    end: nextDate + "T00:00:00+03:00",
  };
}

export default async function DailyFinance({ searchParams }: { searchParams?: { date?: string | string[] } }) {
  const db = await createClient();
  const today = kampalaDate(new Date());
  const dateParam = searchParams?.date;
  const requestedDate = (Array.isArray(dateParam) ? dateParam[0] : dateParam) || today;
  const parsedDate = new Date(requestedDate + "T00:00:00Z");
  const validCalendarDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
    && !Number.isNaN(parsedDate.getTime())
    && parsedDate.toISOString().slice(0, 10) === requestedDate;
  const selectedDate = validCalendarDate && requestedDate <= today ? requestedDate : today;
  const { start, end } = dayBounds(selectedDate);

  const [paymentsResult, expensesResult, refundsResult, sessionsResult, liabilitiesResult, payrollResult, advancesResult] = await Promise.all([
    db.from("payments").select("amount,payment_method,status,created_at")
      .in("status", ["completed", "refunded"]).gte("created_at", start).lt("created_at", end),
    db.from("expenses").select("id,title,amount,payment_status,paid_at,created_at")
      .eq("payment_status", "paid").gte("paid_at", start).lt("paid_at", end),
    db.from("refund_requests").select("id,amount,processed_at,refund_reference")
      .eq("status", "processed").gte("processed_at", start).lt("processed_at", end),
    db.from("cashier_sessions").select("id,cashier_id,opening_float,cash_sales,non_cash_sales,cash_expenses,expected_cash,closing_cash,cash_variance,status,opened_at,closed_at")
      .gte("opened_at", start).lt("opened_at", end).order("opened_at", { ascending: false }),
    db.from("expenses").select("id,amount").eq("approval_status", "approved").eq("payment_status", "unpaid"),
    db.from("payroll_items").select("id,net_pay,paid_at,payment_reference").eq("payment_status", "paid").gte("paid_at", start).lt("paid_at", end),
    db.from("staff_advance_requests").select("id,amount,disbursed_at").eq("status", "disbursed").gte("disbursed_at", start).lt("disbursed_at", end),
  ]);

  const payments = (paymentsResult.data || []) as Payment[];
  const expenses = (expensesResult.data || []) as Expense[];
  const refunds = (refundsResult.data || []) as Refund[];
  const sessions = (sessionsResult.data || []) as Session[];
  const liabilities = liabilitiesResult.data || [];
  const payrollPayments = (payrollResult.data || []) as PayrollPayment[];
  const advanceDisbursements = (advancesResult.data || []) as AdvanceDisbursement[];

  const grossCollections = payments.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const cashCollections = payments.filter((row) => row.payment_method === "cash")
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const nonCashCollections = payments.filter((row) => row.payment_method != null && row.payment_method !== "cash")
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const unclassifiedCollections = payments.filter((row) => row.payment_method == null)
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const paidExpenses = expenses.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const paidPayroll = payrollPayments.reduce((sum, row) => sum + Number(row.net_pay || 0), 0);
  const totalPaidAdvances = advanceDisbursements.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const totalPaidOutflows = paidExpenses + paidPayroll + totalPaidAdvances;
  const processedRefunds = refunds.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const netMovement = grossCollections - totalPaidOutflows - processedRefunds;
  const outstandingApproved = liabilities.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const varianceTotal = sessions.filter((row) => row.status === "closed")
    .reduce((sum, row) => sum + Number(row.cash_variance || 0), 0);

  const errors = [
    paymentsResult.error && "payments",
    expensesResult.error && "paid expenses",
    refundsResult.error && "refunds (apply migration 0012)",
    sessionsResult.error && "cashier sessions (apply migration 0011)",
    liabilitiesResult.error && "approved expense commitments",
    payrollResult.error && "payroll payments (apply migration 0013)",
    advancesResult.error && "advance disbursements (apply migration 0014)",
  ].filter(Boolean);

  const exportRows = [
    ["Buladde Palm Villa Hotel", "Daily finance summary"],
    ["Date", selectedDate],
    ["Currency", "UGX"],
    [],
    ["Collections", "Amount (UGX)"],
    ["Gross completed/refunded payment records", String(grossCollections)],
    ["Cash collections", String(cashCollections)],
    ["Non-cash collections", String(nonCashCollections)],
    ["Unclassified payment method", String(unclassifiedCollections)],
    ["Processed refunds", String(processedRefunds)],
    ["Paid operating expenses", String(paidExpenses)],
    ["Paid payroll", String(paidPayroll)],
    ["Total paid outflows", String(totalPaidOutflows)],
    ["Net recorded movement", String(netMovement)],
    ["Current approved unpaid expenses", String(outstandingApproved)],
    ["Closed cashier shift variance", String(varianceTotal)],
  ];

  return (
    <div className="space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gold">OWNER OFFICE</p>
          <h1 className="mt-1 text-2xl font-semibold text-forest md:text-3xl">Daily reconciliation</h1>
          <p className="mt-2 text-sm text-gray-500">A cash-basis view of recorded collections, settled refunds and expenses.</p>
        </div>
        <ReportExport rows={exportRows} filename={"buladde-daily-finance-" + selectedDate + ".csv"} />
      </header>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-2xl border border-[#EAE6DC] bg-white p-4">
        <label className="grid gap-1 text-sm font-medium text-forest">
          Reporting date
          <input type="date" name="date" defaultValue={selectedDate} max={today}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm" />
        </label>
        <button className="rounded-lg bg-forest px-4 py-2.5 text-sm font-semibold text-white">View day</button>
        <span className="text-xs text-gray-400">All dates use Africa/Kampala time.</span>
      </form>

      {errors.length > 0 && (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Some figures could not be loaded: {errors.join(", ")}. Apply the listed database migrations and confirm owner read permissions before relying on this report.
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Gross collections", grossCollections, "Completed and fully refunded payment records"],
          ["Processed refunds", processedRefunds, "Refunds actually settled and recorded"],
          ["Paid outflows incl. payroll & advances", totalPaidOutflows, "Operating expenses, salary payments and staff advances actually disbursed"],
          ["Net recorded movement", netMovement, "Collections less refunds, operating expenses, payroll and advances"],
        ].map(([label, value, detail]) => (
          <article key={String(label)} className="rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft">
            <p className="text-sm text-gray-500">{label}</p>
            <p className="mt-3 text-2xl font-semibold text-forest">{money(Number(value))}</p>
            <p className="mt-1 text-xs text-gray-400">{detail}</p>
          </article>
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <article className="rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft">
          <h2 className="font-semibold text-forest">Collection breakdown</h2>
          <div className="mt-3 divide-y text-sm">
            <div className="flex justify-between py-3"><span>Cash collections</span><b>{money(cashCollections)}</b></div>
            <div className="flex justify-between py-3"><span>Non-cash collections</span><b>{money(nonCashCollections)}</b></div>
            <div className="flex justify-between py-3"><span>Unclassified payment method</span><b>{money(unclassifiedCollections)}</b></div>
            <div className="flex justify-between py-3"><span>Processed refunds</span><b className="text-rose-700">−{money(processedRefunds)}</b></div>
            <div className="flex justify-between py-3"><span>Paid operating expenses</span><b className="text-rose-700">−{money(paidExpenses)}</b></div>
            <div className="flex justify-between py-3"><span>Paid payroll</span><b className="text-rose-700">−{money(paidPayroll)}</b></div>\n            <div className="flex justify-between py-3"><span>Staff advance disbursements</span><b className="text-rose-700">−{money(totalPaidAdvances)}</b></div>
            <div className="flex justify-between py-3 font-semibold"><span>Net recorded movement</span><b>{money(netMovement)}</b></div>
          </div>
        </article>
        <article className="rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft">
          <h2 className="font-semibold text-forest">Outstanding approved expenses</h2>
          <p className="mt-1 text-xs text-gray-500">Current approved requests not yet marked as paid. This is a current commitment, not a historical daily expense.</p>
          <p className="mt-4 text-2xl font-semibold text-forest">{money(outstandingApproved)}</p>
          <div className="mt-4 flex justify-between border-t pt-3 text-sm">
            <span>Closed cashier shift variance</span>
            <b className={varianceTotal === 0 ? "text-forest" : "text-rose-700"}>{money(varianceTotal)}</b>
          </div>
        </article>
      </section>

      <section className="rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft">
        <h2 className="font-semibold text-forest">Cashier shifts opened on {selectedDate}</h2>
        {sessions.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">No cashier shifts were opened on this date.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead className="text-xs text-gray-500"><tr className="border-b"><th className="py-3 pr-3">Cashier ID</th><th className="py-3 pr-3">Opened</th><th className="py-3 pr-3">Cash sales</th><th className="py-3 pr-3">Cash expenses</th><th className="py-3 pr-3">Expected</th><th className="py-3 pr-3">Counted</th><th className="py-3">Variance</th></tr></thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.id} className="border-b border-gray-100 last:border-0">
                    <td className="py-3 pr-3 font-mono text-xs">{session.cashier_id.slice(0, 8)}…</td>
                    <td className="py-3 pr-3">{new Date(session.opened_at).toLocaleTimeString("en-UG", { timeZone: "Africa/Kampala" })}</td>
                    <td className="py-3 pr-3">{session.cash_sales == null ? "Open" : money(Number(session.cash_sales))}</td>
                    <td className="py-3 pr-3">{session.cash_expenses == null ? "Open" : money(Number(session.cash_expenses))}</td>
                    <td className="py-3 pr-3">{session.expected_cash == null ? "Open" : money(Number(session.expected_cash))}</td>
                    <td className="py-3 pr-3">{session.closing_cash == null ? "Open" : money(Number(session.closing_cash))}</td>
                    <td className={session.cash_variance != null && Number(session.cash_variance) !== 0 ? "py-3 font-semibold text-rose-700" : "py-3"}>{session.cash_variance == null ? "Open" : money(Number(session.cash_variance))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-xs text-gray-400">
        This is an operational cash-movement report, not an audited profit-and-loss statement. It excludes unpaid expenses, inventory consumption, depreciation, taxes, accrual adjustments and revenue not yet represented by a completed payment. Payroll is included only after a salary payment is recorded as completed. A fully refunded payment remains in gross collections where its payment status is retained as refunded, then its processed refund is deducted here.
      </p>
    </div>
  );
}
