import { createClient } from "@/lib/supabase/server";
import { PayrollControls } from "@/components/payroll-controls";

export const dynamic = "force-dynamic";

export default async function PayrollPage() {
  const db = await createClient();
  const [staffResult, salaryResult, runsResult, itemsResult] = await Promise.all([
    db.from("profiles").select("id,full_name,role").eq("is_active", true).in("role", ["staff", "manager"]).order("full_name"),
    db.from("staff_salary_settings").select("staff_id,base_salary,allowances,default_deductions,effective_from,is_active"),
    db.from("payroll_runs").select("id,period_start,period_end,status,total_gross,total_deductions,total_net").order("period_start", { ascending: false }),
    db.from("payroll_items").select("id,payroll_run_id,staff_id,base_salary,allowances,deductions,net_pay,payment_status,payment_method,payment_reference"),
  ]);

  const salaries = new Map((salaryResult.data || []).map((row: any) => [row.staff_id, row]));
  const staff = (staffResult.data || []).map((person: any) => ({
    ...person,
    salary: salaries.get(person.id) || null,
  }));
  const names = new Map(staff.map((person: any) => [person.id, person.full_name]));
  const itemsByRun = new Map<string, any[]>();
  for (const item of itemsResult.data || []) {
    const current = itemsByRun.get(item.payroll_run_id) || [];
    current.push({ ...item, staff: { full_name: names.get(item.staff_id) || "Former staff member" } });
    itemsByRun.set(item.payroll_run_id, current);
  }
  const runs = (runsResult.data || []).map((run: any) => ({
    ...run,
    items: itemsByRun.get(run.id) || [],
  }));
  const migrationError = !!(salaryResult.error || runsResult.error || itemsResult.error);

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm font-medium text-gold">OWNER OFFICE</p>
        <h1 className="mt-1 text-2xl font-semibold text-forest md:text-3xl">Staff payroll</h1>
        <p className="mt-2 text-sm text-gray-500">Set salary terms, prepare monthly payroll, approve it and record completed payments.</p>
      </header>
      <PayrollControls staff={staff as any} runs={runs as any} migrationError={migrationError} />
    </div>
  );
}
