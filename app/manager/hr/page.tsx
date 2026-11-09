import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { HrRequests } from "@/components/hr-requests";

export const dynamic = "force-dynamic";

export default async function HrWorkspacePage() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await db.from("profiles").select("role,department_id,departments(slug)").eq("id", user.id).single();
  const department = profile?.departments as unknown as { slug: string } | null;
  if (profile?.role !== "manager" || department?.slug !== "human-resources") redirect("/manager/dashboard");

  const [staffResult, advancesResult, deductionsResult, repaymentsResult] = await Promise.all([
    db.rpc("hr_staff_directory"),
    db.from("staff_advance_requests").select("id,staff_id,amount,repayment_per_month,reason,status,created_at,rejection_reason").order("created_at", { ascending: false }),
    db.from("salary_deduction_requests").select("id,staff_id,amount,reason,effective_month,status,created_at,rejection_reason").order("created_at", { ascending: false }),
    db.from("staff_advance_repayments").select("advance_id,amount,status"),
  ]);

  return (
    <main className="space-y-6">
      <header>
        <p className="text-xs font-bold tracking-widest text-gold">HUMAN RESOURCES</p>
        <h1 className="mt-2 text-3xl font-semibold text-forest">Staff advances & deductions</h1>
        <p className="mt-2 text-sm text-gray-500">Submit requests, track approvals and monitor advance repayment progress. Salary settings and payroll approvals remain owner-only.</p>
      </header>
      <HrRequests
        staff={(staffResult.data || []) as any}
        advances={(advancesResult.data || []) as any}
        deductions={(deductionsResult.data || []) as any}
        repayments={(repaymentsResult.data || []) as any}
        loadError={!!(staffResult.error || advancesResult.error || deductionsResult.error || repaymentsResult.error)}
      />
    </main>
  );
}
