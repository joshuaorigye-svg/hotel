import { createClient } from "@/lib/supabase/server";
import { ReportExport } from "@/components/report-export";

export const dynamic = "force-dynamic";

type Payment = { amount: number | string | null; created_at: string; status: string };
type Expense = { id: string; title: string; amount: number | string | null; category: string | null; department_id: string | null; paid_at: string | null };
type Refund = { amount: number | string | null; processed_at: string | null };
type PayrollPayment = { net_pay: number | string | null; paid_at: string | null };
type AdvanceDisbursement = { amount: number | string | null; disbursed_at: string | null };
type Department = { id: string; name: string };
type Liability = { amount: number | string | null; department_id: string | null };

const money = (value: number) => new Intl.NumberFormat("en-UG", {
  style: "currency", currency: "UGX", maximumFractionDigits: 0,
}).format(value || 0);

function kampalaYear(now: Date) {
  return Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Kampala", year: "numeric",
  }).format(now));
}

function monthKey(value: string) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Kampala", year: "numeric", month: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return get("year") + "-" + get("month");
}

function monthLabel(key: string) {
  return new Intl.DateTimeFormat("en-UG", {
    month: "short", timeZone: "UTC",
  }).format(new Date(key + "-01T00:00:00Z"));
}

export default async function FinancialPerformance({
  searchParams,
}: {
  searchParams?: { year?: string | string[] };
}) {
  const db = await createClient();
  const currentYear = kampalaYear(new Date());
  const rawYear = searchParams?.year;
  const requestedYear = Array.isArray(rawYear) ? rawYear[0] : rawYear;
  const parsedYear = Number(requestedYear);
  const year = Number.isInteger(parsedYear) && parsedYear >= currentYear - 4 && parsedYear <= currentYear
    ? parsedYear : currentYear;
  const start = year + "-01-01T00:00:00+03:00";
  const end = (year + 1) + "-01-01T00:00:00+03:00";

  const [paymentsResult, expensesResult, refundsResult, liabilitiesResult, departmentsResult, payrollResult, advancesResult] = await Promise.all([
    db.from("payments").select("amount,created_at,status")
      .in("status", ["completed", "refunded"]).gte("created_at", start).lt("created_at", end),
    db.from("expenses").select("id,title,amount,category,department_id,paid_at")
      .eq("payment_status", "paid").gte("paid_at", start).lt("paid_at", end),
    db.from("refund_requests").select("amount,processed_at")
      .eq("status", "processed").gte("processed_at", start).lt("processed_at", end),
    db.from("expenses").select("amount,department_id")
      .eq("approval_status", "approved").eq("payment_status", "unpaid"),
    db.from("departments").select("id,name").order("name"),
    db.from("payroll_items").select("net_pay,paid_at").eq("payment_status", "paid").gte("paid_at", start).lt("paid_at", end),
    db.from("staff_advance_requests").select("amount,disbursed_at").eq("status", "disbursed").gte("disbursed_at", start).lt("disbursed_at", end),
  ]);

  const payments = (paymentsResult.data || []) as Payment[];
  const expenses = (expensesResult.data || []) as Expense[];
  const refunds = (refundsResult.data || []) as Refund[];
  const liabilities = (liabilitiesResult.data || []) as Liability[];
  const departments = (departmentsResult.data || []) as Department[];
  const payrollPayments = (payrollResult.data || []) as PayrollPayment[];
  const advanceDisbursements = (advancesResult.data || []) as AdvanceDisbursement[];
  const departmentNames = new Map(departments.map((department) => [department.id, department.name]));

  const grossCollections = payments.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const paidExpenses = expenses.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const paidPayroll = payrollPayments.reduce((sum, row) => sum + Number(row.net_pay || 0), 0);
  const totalPaidAdvances = advanceDisbursements.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const totalPaidOutflows = paidExpenses + paidPayroll + totalPaidAdvances;
  const processedRefunds = refunds.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const netMovement = grossCollections - totalPaidOutflows - processedRefunds;
  const outstandingLiabilities = liabilities.reduce((sum, row) => sum + Number(row.amount || 0), 0);

  const monthKeys = Array.from({ length: 12 }, (_, index) => year + "-" + String(index + 1).padStart(2, "0"));
  const monthly = monthKeys.map((key) => {
    const collections = payments.filter((row) => monthKey(row.created_at) === key)
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const expenseTotal = expenses.filter((row) => row.paid_at && monthKey(row.paid_at) === key)
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const payrollTotal = payrollPayments.filter((row) => row.paid_at && monthKey(row.paid_at) === key)
      .reduce((sum, row) => sum + Number(row.net_pay || 0), 0);
    const advanceTotal = advanceDisbursements.filter((row) => row.disbursed_at && monthKey(row.disbursed_at) === key)
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const refundTotal = refunds.filter((row) => row.processed_at && monthKey(row.processed_at) === key)
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    return { month: key, collections, expenses: expenseTotal, payroll: payrollTotal, advances: advanceTotal, refunds: refundTotal, net: collections - expenseTotal - payrollTotal - advanceTotal - refundTotal };
  });

  const departmentTotals = new Map<string, number>();
  const categoryTotals = new Map<string, number>();
  for (const expense of expenses) {
    const department = expense.department_id ? departmentNames.get(expense.department_id) : undefined;
    const departmentName = department || "Unassigned";
    departmentTotals.set(departmentName, (departmentTotals.get(departmentName) || 0) + Number(expense.amount || 0));
    const category = expense.category?.trim() || "General";
    categoryTotals.set(category, (categoryTotals.get(category) || 0) + Number(expense.amount || 0));
  }
  const liabilityByDepartment = new Map<string, number>();
  for (const expense of liabilities) {
    const name = expense.department_id ? departmentNames.get(expense.department_id) : undefined;
    const key = name || "Unassigned";
    liabilityByDepartment.set(key, (liabilityByDepartment.get(key) || 0) + Number(expense.amount || 0));
  }

  const errors = [
    paymentsResult.error && "payment records",
    expensesResult.error && "paid expenses",
    refundsResult.error && "processed refunds (apply migration 0012)",
    liabilitiesResult.error && "approved unpaid expenses",
    departmentsResult.error && "departments",
    payrollResult.error && "payroll payments (apply migration 0013)",
    advancesResult.error && "advance disbursements (apply migration 0014)",
  ].filter(Boolean);
  const exportRows = [
    ["Buladde Palm Villa Hotel", "Annual financial performance", year],
    ["Currency", "UGX"],
    [],
    ["Month", "Collections", "Paid operating expenses", "Paid payroll", "Advance disbursements", "Processed refunds", "Net recorded movement"],
    ...monthly.map((row) => [row.month, String(row.collections), String(row.expenses), String(row.payroll), String(row.advances), String(row.refunds), String(row.net)]),
    [],
    ["Paid expenses by department", "Amount (UGX)"],
    ...Array.from(departmentTotals.entries()).sort((a, b) => b[1] - a[1]).map(([name, amount]) => [name, String(amount)]),
    [],
    ["Paid expenses by category", "Amount (UGX)"],
    ...Array.from(categoryTotals.entries()).sort((a, b) => b[1] - a[1]).map(([name, amount]) => [name, String(amount)]),
    [],
    ["Paid payroll total", String(paidPayroll)],
    ["Staff advance disbursements", String(totalPaidAdvances)],
    ["Current approved unpaid expenses", String(outstandingLiabilities)],
  ];
  const maxBar = Math.max(1, ...monthly.flatMap((row) => [row.collections, row.expenses + row.payroll + row.advances + row.refunds]));

  return (
    <div className="space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gold">OWNER OFFICE</p>
          <h1 className="mt-1 text-2xl font-semibold text-forest md:text-3xl">Financial performance</h1>
          <p className="mt-2 text-sm text-gray-500">Annual cash movement, paid expenses, payroll, staff advances, refunds and current commitments.</p>
        </div>
        <ReportExport rows={exportRows} filename={"buladde-financial-performance-" + year + ".csv"} />
      </header>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-2xl border border-[#EAE6DC] bg-white p-4">
        <label className="grid gap-1 text-sm font-medium text-forest">
          Reporting year
          <select name="year" defaultValue={String(year)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm">
            {Array.from({ length: 5 }, (_, index) => currentYear - index).map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
        <button className="rounded-lg bg-forest px-4 py-2.5 text-sm font-semibold text-white">View year</button>
        <span className="text-xs text-gray-400">Reporting boundaries use Africa/Kampala time.</span>
      </form>

      {errors.length > 0 && (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Some figures could not be loaded: {errors.join(", ")}. Check migration status and owner read permissions before relying on this report.
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Recorded collections", grossCollections, "Payments received in the selected year"],
          ["Paid outflows incl. payroll & advances", totalPaidOutflows, "Operating expenses, salaries and staff advances actually disbursed in the selected year"],
          ["Processed refunds", processedRefunds, "Refunds recorded as completed in the selected year"],
          ["Net recorded movement", netMovement, "Collections less paid expenses, payroll, advances and processed refunds"],
        ].map(([label, amount, detail]) => (
          <article key={String(label)} className="rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft">
            <p className="text-sm text-gray-500">{label}</p>
            <p className="mt-3 text-2xl font-semibold text-forest">{money(Number(amount))}</p>
            <p className="mt-1 text-xs text-gray-400">{detail}</p>
          </article>
        ))}
      </section>

      <section className="rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft">
        <h2 className="font-semibold text-forest">Monthly cash movement</h2>
        <p className="mt-1 text-xs text-gray-500">Green bars show recorded collections; amber bars combine paid expenses, payroll, advance disbursements and processed refunds.</p>
        <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
          {monthly.map((row) => (
            <div key={row.month} className="min-w-0">
              <div className="mb-2 flex justify-between gap-2 text-[11px] text-gray-500">
                <span>{monthLabel(row.month)}</span><span className="truncate">{money(row.net)}</span>
              </div>
              <div className="flex h-28 items-end gap-1 rounded-lg bg-[#F7F5EF] px-2 pt-2">
                <div title={"Collections " + money(row.collections)} className="min-w-1 flex-1 rounded-t bg-emerald-600" style={{ height: Math.max(row.collections ? 3 : 0, (row.collections / maxBar) * 100) + "%" }} />
                <div title={"Expenses, payroll, advances and refunds " + money(row.expenses + row.payroll + row.refunds)} className="min-w-1 flex-1 rounded-t bg-amber-500" style={{ height: Math.max(row.expenses + row.payroll + row.refunds ? 3 : 0, ((row.expenses + row.payroll + row.refunds) / maxBar) * 100) + "%" }} />
              </div>
              <p className="mt-1 truncate text-[10px] text-gray-400">Paid operating expenses: {money(row.expenses)}</p>
              <p className="truncate text-[10px] text-gray-400">Paid payroll: {money(row.payroll)}</p>
              <p className="truncate text-[10px] text-gray-400">Staff advances: {money(row.advances)}</p>
              <p className="truncate text-[10px] text-gray-400">Refunds: {money(row.refunds)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft">
        <h2 className="font-semibold text-forest">Monthly figures</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="text-xs text-gray-500"><tr className="border-b"><th className="py-3 pr-3">Month</th><th className="py-3 pr-3">Collections</th><th className="py-3 pr-3">Operating expenses</th><th className="py-3 pr-3">Payroll</th><th className="py-3 pr-3">Advances</th><th className="py-3 pr-3">Refunds</th><th className="py-3">Net movement</th></tr></thead>
            <tbody>
              {monthly.map((row) => (
                <tr key={row.month} className="border-b border-gray-100 last:border-0">
                  <td className="py-3 pr-3 font-medium">{monthLabel(row.month)}</td>
                  <td className="py-3 pr-3">{money(row.collections)}</td>
                  <td className="py-3 pr-3">{money(row.expenses)}</td>
                  <td className="py-3 pr-3">{money(row.payroll)}</td>
                  <td className="py-3 pr-3">{money(row.advances)}</td>
                  <td className="py-3 pr-3">{money(row.refunds)}</td>
                  <td className="py-3 font-semibold">{money(row.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft">
          <h2 className="font-semibold text-forest">Paid expenses by department</h2>
          {departmentTotals.size === 0 ? <p className="py-6 text-sm text-gray-400">No paid expenses in this year.</p> :
            Array.from(departmentTotals.entries()).sort((a, b) => b[1] - a[1]).map(([name, amount]) => (
              <div key={name} className="border-b py-3 last:border-0">
                <div className="flex justify-between gap-3 text-sm"><span>{name}</span><b>{money(amount)}</b></div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full bg-amber-500" style={{ width: Math.min(100, amount / Math.max(1, paidExpenses) * 100) + "%" }} /></div>
              </div>
            ))}
        </section>
        <section className="rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft">
          <h2 className="font-semibold text-forest">Paid expenses by category</h2>
          {categoryTotals.size === 0 ? <p className="py-6 text-sm text-gray-400">No categorised paid expenses in this year.</p> :
            Array.from(categoryTotals.entries()).sort((a, b) => b[1] - a[1]).map(([name, amount]) => (
              <div key={name} className="flex justify-between gap-3 border-b py-3 text-sm last:border-0"><span className="capitalize">{name.replace(/_/g, " ")}</span><b>{money(amount)}</b></div>
            ))}
        </section>
      </div>

      <section className="rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-forest">Approved but unpaid commitments</h2>
            <p className="mt-1 text-xs text-gray-500">Current approved expense requests that have not yet been marked paid. They are not deducted from this year&apos;s cash movement.</p>
          </div>
          <p className="text-xl font-semibold text-forest">{money(outstandingLiabilities)}</p>
        </div>
        {liabilityByDepartment.size > 0 && <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from(liabilityByDepartment.entries()).sort((a, b) => b[1] - a[1]).map(([name, amount]) => (
            <div key={name} className="rounded-xl bg-[#F7F5EF] p-3 text-sm"><p className="text-gray-500">{name}</p><b className="mt-1 block text-forest">{money(amount)}</b></div>
          ))}
        </div>}
      </section>

      <p className="text-xs text-gray-400">
        This is a cash-movement management report, not an audited profit-and-loss statement. It uses payment and settlement dates, excludes unpaid expense commitments from cash outflows, and does not yet include inventory cost of goods sold, unpaid payroll accruals, depreciation, taxes or other journal adjustments. Paid payroll is included only after payment is recorded; staff advances are included on their actual disbursement date. Restaurant order totals are not added separately because their receipts are already represented in the payments table.
      </p>
    </div>
  );
}
