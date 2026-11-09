import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const money = (value: number | string) => new Intl.NumberFormat("en-UG", {
  style: "currency", currency: "UGX", maximumFractionDigits: 0,
}).format(Number(value) || 0);

export default async function MyPayslipsPage() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return null;

  const { data, error } = await db
    .from("payroll_items")
    .select("id,base_salary,allowances,deductions,advance_deductions,other_deductions,net_pay,payment_status,payment_method,payment_reference,paid_at,payroll_runs(period_start,period_end,status)")
    .eq("staff_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm font-medium text-gold">STAFF WORKSPACE</p>
        <h1 className="mt-1 text-2xl font-semibold text-forest">My payslips</h1>
        <p className="mt-2 text-sm text-gray-500">Only your own approved payroll records are shown here.</p>
      </header>
      {error ? (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Payslips are not available yet. Ask the hotel administrator to confirm payroll migration 0013 has been applied.
        </div>
      ) : !data?.length ? (
        <section className="rounded-2xl border border-[#EAE6DC] bg-white p-8 text-center text-sm text-gray-500">
          No approved payslips are available yet.
        </section>
      ) : (
        <section className="space-y-4">
          {data.map((item: any) => {
            const run = item.payroll_runs;
            const period = run?.period_start
              ? new Intl.DateTimeFormat("en-UG", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(run.period_start + "T00:00:00Z"))
              : "Payroll period";
            return (
              <article key={item.id} className="rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-semibold text-forest">{period}</h2>
                  <span className={item.payment_status === "paid" ? "rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700" : "rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700"}>
                    {item.payment_status === "paid" ? "Paid" : "Approved · awaiting payment"}
                  </span>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                  <div><dt className="text-xs text-gray-500">Base salary</dt><dd className="mt-1 font-medium">{money(item.base_salary)}</dd></div>
                  <div><dt className="text-xs text-gray-500">Allowances</dt><dd className="mt-1 font-medium">{money(item.allowances)}</dd></div>
                  <div><dt className="text-xs text-gray-500">Deductions</dt><dd className="mt-1 font-medium">{money(item.deductions)}</dd><dd className="mt-1 text-[10px] text-gray-400">Advance {money(item.advance_deductions || 0)} · Other {money(item.other_deductions || 0)}</dd></div>
                  <div><dt className="text-xs text-gray-500">Net pay</dt><dd className="mt-1 font-semibold text-forest">{money(item.net_pay)}</dd></div>
                </dl>
                {item.payment_status === "paid" && <p className="mt-4 border-t pt-3 text-xs text-gray-500">Payment method: {item.payment_method || "Not recorded"} · Reference: {item.payment_reference || "Not recorded"}{item.paid_at ? " · Paid " + new Date(item.paid_at).toLocaleDateString("en-UG", { timeZone: "Africa/Kampala" }) : ""}</p>}
              </article>
            );
          })}
        </section>
      )}
      <p className="text-xs text-gray-400">This payslip is an internal salary record. It does not calculate statutory deductions or replace official tax and pension documents.</p>
    </div>
  );
}
