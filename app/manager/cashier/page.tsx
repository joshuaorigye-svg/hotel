import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { FinanceControls } from "@/components/finance-controls";

export const dynamic = "force-dynamic";

export default async function ManagerCashierPage() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await db.from("profiles").select("role,department_id,departments(slug,name)").eq("id", user.id).single();
  if (profile?.role !== "manager" || !profile.department_id) redirect("/staff/tasks");
  const department = Array.isArray(profile.departments) ? profile.departments[0] : profile.departments;
  if (!department || !["front-desk", "restaurant-kitchen", "bar"].includes(department.slug)) redirect("/manager/dashboard");

  const { data: session } = await db.from("cashier_sessions")
    .select("id,opening_float,opened_at")
    .eq("cashier_id", user.id)
    .eq("status", "open")
    .maybeSingle();

  return (
    <main className="space-y-6">
      <div>
        <p className="text-xs font-bold tracking-widest text-gold">DEPARTMENT CASHIER</p>
        <h1 className="mt-2 text-3xl font-semibold text-forest">Cashier shift</h1>
        <p className="mt-2 text-sm text-gray-500">{department.name} · Open and close your shift, then reconcile the cash drawer.</p>
      </div>
      <FinanceControls pendingExpenses={[]} payableExpenses={[]} departments={[]} openSession={session || null} managerMode />
      <p className="text-xs text-gray-400">Your shift records only completed payments attributed to your staff account. The owner can review all department cashier sessions from the financial control centre.</p>
    </main>
  );
}
