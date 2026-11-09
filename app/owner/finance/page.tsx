import { createClient } from "@/lib/supabase/server";
import { FinanceControls } from "@/components/finance-controls";

export const dynamic = "force-dynamic";

type Payment = { amount: number | string | null; payment_method: string | null; created_at: string };
type Expense = {
  id: string; title: string; description: string | null; amount: number | string;
  category: string; approval_status: string; created_at: string;
  department_id: string | null; created_by: string | null; rejection_reason: string | null;
  reviewed_at: string | null; payment_status: string; paid_at: string | null;
};
type Session = {
  id: string; cashier_id: string; department_id: string | null; opening_float: number | string;
  closing_cash: number | string | null; expected_cash: number | string | null;
  cash_sales: number | string | null; non_cash_sales: number | string | null; cash_expenses: number | string | null;
  cash_variance: number | string | null; status: string; opened_at: string; closed_at: string | null;
};
type Profile = { id: string; full_name: string };
type Department = { id: string; name: string };

const money = (value: number) =>
  new Intl.NumberFormat("en-UG", {
    style: "currency", currency: "UGX", maximumFractionDigits: 0,
  }).format(value || 0);

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-3 text-2xl font-semibold text-forest">{value}</p>
      <p className="mt-1 text-xs text-gray-400">{detail}</p>
    </article>
  );
}

export default async function Finance() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [paymentsResult, expensesResult, sessionsResult, departmentsResult, profilesResult] = await Promise.all([
    db.from("payments").select("amount,payment_method,created_at").eq("status", "completed").gte("created_at", thirtyDaysAgo).order("created_at", { ascending: false }).limit(1000),
    db.from("expenses").select("id,title,description,amount,category,approval_status,created_at,department_id,created_by,rejection_reason,reviewed_at,payment_status,paid_at").order("created_at", { ascending: false }).limit(100),
    db.from("cashier_sessions").select("id,cashier_id,department_id,opening_float,closing_cash,expected_cash,cash_sales,non_cash_sales,cash_expenses,cash_variance,status,opened_at,closed_at").order("opened_at", { ascending: false }).limit(50),
    db.from("departments").select("id,name").order("name"),
    db.from("profiles").select("id,full_name"),
  ]);

  const payments = (paymentsResult.data || []) as Payment[];
  const expenses = (expensesResult.data || []) as Expense[];
  const sessions = (sessionsResult.data || []) as Session[];
  const departments = (departmentsResult.data || []) as Department[];
  const profiles = (profilesResult.data || []) as Profile[];
  const profileNames = new Map(profiles.map((profile) => [profile.id, profile.full_name]));
  const departmentNames = new Map(departments.map((department) => [department.id, department.name]));

  const collected = payments.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const methodTotals = new Map<string, number>();
  for (const payment of payments) {
    const method = payment.payment_method || "unclassified";
    methodTotals.set(method, (methodTotals.get(method) || 0) + Number(payment.amount || 0));
  }
  const pendingExpenses = expenses.filter((expense) => expense.approval_status === "pending");
  const payableExpenses = expenses.filter((expense) => expense.approval_status === "approved" && expense.payment_status !== "paid");
  const approvedThisMonth = expenses
    .filter((expense) => expense.approval_status === "approved" && !!expense.reviewed_at && expense.reviewed_at >= monthStart)
    .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const openSessions = sessions.filter((session) => session.status === "open");
  const ownOpenSession = sessions.find((session) => session.status === "open" && session.cashier_id === user?.id) || null;
  const dataErrors = [
    paymentsResult.error && "payments",
    expensesResult.error && "expenses",
    sessionsResult.error && "cashier sessions",
    departmentsResult.error && "departments",
    profilesResult.error && "staff profiles",
  ].filter(Boolean);

  return (
    <div className="space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gold">OWNER OFFICE</p>
          <h1 className="mt-1 text-2xl font-semibold text-forest md:text-3xl">Financial control centre</h1>
          <p className="mt-2 text-sm text-gray-500">Collections, expense approvals and cashier accountability in one place.</p>
        </div>
        <span className="rounded-full bg-[#F4F1E8] px-3 py-2 text-xs text-gray-600">UGX · Africa/Kampala</span>
      </header>

      {dataErrors.length > 0 && (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Some finance data could not be loaded: {dataErrors.join(", ")}. Confirm that migration 0011 has been applied and the relevant Supabase permissions are active. Available sections are still shown below.
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Collections · last 30 days" value={money(collected)} detail="Completed payment records only" />
        <Metric label="Approved expenses · this month" value={money(approvedThisMonth)} detail="Based on owner approval date" />
        <Metric label="Awaiting approval" value={String(pendingExpenses.length)} detail="Expense requests requiring owner review" />
        <Metric label="Open cashier shifts" value={String(openSessions.length)} detail="Cashier sessions not yet reconciled" />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <div className="rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft">
          <h2 className="font-semibold text-forest">Collections by payment method</h2>
          <p className="mt-1 text-xs text-gray-500">Completed payments recorded in the last 30 days.</p>
          {methodTotals.size === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">No completed payments in this period.</p>
          ) : (
            <div className="mt-4 space-y-4">
              {Array.from(methodTotals.entries()).sort((a, b) => b[1] - a[1]).map(([method, value]) => (
                <div key={method}>
                  <div className="mb-1 flex justify-between gap-3 text-sm">
                    <span className="capitalize">{method.replaceAll("_", " ")}</span><b>{money(value)}</b>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full rounded-full bg-emerald-700" style={{ width: Math.min(100, value / Math.max(1, collected) * 100) + "%" }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft">
          <h2 className="font-semibold text-forest">Latest expense decisions</h2>
          <p className="mt-1 text-xs text-gray-500">Recent approved and rejected requests.</p>
          {expenses.filter((expense) => expense.approval_status !== "pending").slice(0, 6).length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">No reviewed expenses recorded yet.</p>
          ) : (
            <div className="mt-3 divide-y">
              {expenses.filter((expense) => expense.approval_status !== "pending").slice(0, 6).map((expense) => (
                <div key={expense.id} className="flex items-start justify-between gap-3 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-forest">{expense.title}</p>
                    <p className="mt-1 text-xs text-gray-400">{departmentNames.get(expense.department_id || "") || "Unassigned"} · {new Date(expense.created_at).toLocaleDateString("en-UG")}</p>
                    {expense.rejection_reason && <p className="mt-1 text-xs text-rose-700">Reason: {expense.rejection_reason}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    <b>{money(Number(expense.amount))}</b>
                    <p className={expense.approval_status === "approved" ? "mt-1 text-xs capitalize text-emerald-700" : "mt-1 text-xs capitalize text-rose-700"}>{expense.approval_status}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <FinanceControls pendingExpenses={pendingExpenses} payableExpenses={payableExpenses} departments={departments} openSession={ownOpenSession} />

      <section className="rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft">
        <h2 className="font-semibold text-forest">Cashier shift register</h2>
        <p className="mt-1 text-xs text-gray-500">Shift totals are calculated from completed payments attributed to each cashier account.</p>
        {sessions.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">No cashier shifts recorded yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="text-xs text-gray-500">
                <tr className="border-b"><th className="py-3 pr-3">Cashier</th><th className="py-3 pr-3">Department</th><th className="py-3 pr-3">Opened</th><th className="py-3 pr-3">Cash sales</th><th className="py-3 pr-3">Expected cash</th><th className="py-3 pr-3">Variance</th><th className="py-3">Status</th></tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.id} className="border-b border-gray-100 last:border-0">
                    <td className="py-3 pr-3 font-medium text-forest">{profileNames.get(session.cashier_id) || "Staff account"}</td>
                    <td className="py-3 pr-3">{departmentNames.get(session.department_id || "") || "Owner office"}</td>
                    <td className="py-3 pr-3">{new Date(session.opened_at).toLocaleString("en-UG", { timeZone: "Africa/Kampala" })}</td>
                    <td className="py-3 pr-3">{session.cash_sales == null ? "Pending close" : money(Number(session.cash_sales))}</td>
                    <td className="py-3 pr-3">{session.expected_cash == null ? "Pending close" : money(Number(session.expected_cash))}</td>
                    <td className={session.cash_variance != null && Number(session.cash_variance) !== 0 ? "py-3 pr-3 font-semibold text-rose-700" : "py-3 pr-3"}>{session.cash_variance == null ? "Pending close" : money(Number(session.cash_variance))}</td>
                    <td className="py-3"><span className={session.status === "open" ? "rounded-full bg-amber-50 px-2 py-1 text-xs text-amber-800" : "rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-800"}>{session.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft">
        <h2 className="font-semibold text-forest">Recent expense register</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[700px] text-left text-sm">
            <thead className="text-xs text-gray-500"><tr className="border-b"><th className="py-3 pr-3">Expense</th><th className="py-3 pr-3">Department</th><th className="py-3 pr-3">Requested by</th><th className="py-3 pr-3">Amount</th><th className="py-3">Status</th></tr></thead>
            <tbody>
              {expenses.slice(0, 12).map((expense) => (
                <tr key={expense.id} className="border-b border-gray-100 last:border-0">
                  <td className="py-3 pr-3"><span className="font-medium text-forest">{expense.title}</span><span className="block text-xs text-gray-400">{expense.category.replaceAll("_", " ")}</span></td>
                  <td className="py-3 pr-3">{departmentNames.get(expense.department_id || "") || "Unassigned"}</td>
                  <td className="py-3 pr-3">{profileNames.get(expense.created_by || "") || "Unknown"}</td>
                  <td className="py-3 pr-3">{money(Number(expense.amount))}</td>
                  <td className="py-3 capitalize">{expense.approval_status}</td>
                </tr>
              ))}
              {expenses.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-sm text-gray-400">No expenses recorded.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-xs text-gray-400">Collections include completed records in the payments table. Cash reconciliation includes completed payments attributed to the cashier who opened the shift. Online payments without a cashier attribution are not assigned to a cashier drawer. This dashboard is an operational control view, not an audited financial statement.</p>
    </div>
  );
}
