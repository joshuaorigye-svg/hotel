"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Expense = {
  id: string;
  title: string;
  description: string | null;
  amount: number | string;
  category: string;
  created_at: string;
  department_id: string | null;
  created_by: string | null;
  payment_status?: string;
};
type Department = { id: string; name: string };
type Session = {
  id: string;
  opening_float: number | string;
  opened_at: string;
};

const money = (value: number | string) =>
  new Intl.NumberFormat("en-UG", { style: "currency", currency: "UGX", maximumFractionDigits: 0 }).format(Number(value) || 0);

export function FinanceControls({
  pendingExpenses,
  payableExpenses,
  departments,
  openSession,
  cashierOnly = false,
  managerMode = false,
}: {
  pendingExpenses: Expense[];
  payableExpenses: Expense[];
  departments: Department[];
  openSession: Session | null;
  cashierOnly?: boolean;
  managerMode?: boolean;
}) {
  const db = createClient();
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("supplies");
  const [departmentId, setDepartmentId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [openingFloat, setOpeningFloat] = useState("0");
  const [countedCash, setCountedCash] = useState("");
  const [closingNotes, setClosingNotes] = useState("");
  const [rejectionReasons, setRejectionReasons] = useState<Record<string, string>>({});
  const [expensePaymentMethods, setExpensePaymentMethods] = useState<Record<string, string>>({});
  const [reconciliation, setReconciliation] = useState<{
    opening_float: number;
    cash_sales: number;
    non_cash_sales: number;
    cash_expenses: number;
    expected_cash: number;
    counted_cash: number;
    variance: number;
  } | null>(null);

  const departmentOptions = useMemo(() => departments, [departments]);

  function reportError(text: string) {
    setIsError(true);
    setMessage(text);
  }

  async function submitExpense(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("expense");
    setMessage("");
    setIsError(false);
    const numericAmount = Number(amount);
    if (!Number.isSafeInteger(numericAmount) || numericAmount <= 0) {
      reportError("Enter a whole-number amount greater than zero.");
      setBusy("");
      return;
    }
    const { error } = await db.rpc("submit_expense_request", {
      p_title: title.trim(),
      p_amount: numericAmount,
      p_department_id: departmentId || null,
      p_description: description.trim() || null,
      p_category: category,
      p_payment_method: paymentMethod,
      p_receipt_reference: null,
    });
    if (error) reportError(error.message);
    else {
      setMessage("Expense request submitted for approval.");
      setTitle("");
      setDescription("");
      setAmount("");
      setDepartmentId("");
      router.refresh();
    }
    setBusy("");
  }

  async function reviewExpense(id: string, decision: "approved" | "rejected") {
    const reason = rejectionReasons[id]?.trim() || "";
    if (decision === "rejected" && !reason) {
      reportError("Add a reason before rejecting this expense.");
      return;
    }
    setBusy(id);
    setMessage("");
    setIsError(false);
    const { error } = await db.rpc("review_expense_request", {
      p_expense_id: id,
      p_decision: decision,
      p_rejection_reason: decision === "rejected" ? reason : null,
    });
    if (error) reportError(error.message);
    else {
      setMessage(decision === "approved" ? "Expense approved." : "Expense rejected with a recorded reason.");
      router.refresh();
    }
    setBusy("");
  }

  async function markExpensePaid(id: string) {
    setBusy("pay-expense-" + id);
    setMessage("");
    setIsError(false);
    const { error } = await db.rpc("mark_expense_paid", {
      p_expense_id: id,
      p_payment_method: expensePaymentMethods[id] || "cash",
      p_receipt_reference: null,
    });
    if (error) reportError(error.message);
    else {
      setMessage("Expense marked as paid. Cash payments will be included in the next cashier reconciliation.");
      router.refresh();
    }
    setBusy("");
  }

  async function openShift(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("open");
    setMessage("");
    setIsError(false);
    const value = Number(openingFloat);
    if (!Number.isSafeInteger(value) || value < 0) {
      reportError("Opening float must be a whole-number UGX amount.");
      setBusy("");
      return;
    }
    const { error } = await db.rpc("open_cashier_session", {
      p_opening_float: value,
      p_opening_notes: null,
    });
    if (error) reportError(error.message);
    else {
      setMessage("Cashier shift opened. Payments recorded by your account will be included in its reconciliation.");
      setOpeningFloat("0");
      router.refresh();
    }
    setBusy("");
  }

  async function closeShift(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("close");
    setMessage("");
    setIsError(false);
    const value = Number(countedCash);
    if (!Number.isSafeInteger(value) || value < 0) {
      reportError("Counted cash must be a whole-number UGX amount.");
      setBusy("");
      return;
    }
    const { data, error } = await db.rpc("close_cashier_session", {
      p_counted_cash: value,
      p_closing_notes: closingNotes.trim() || null,
    });
    if (error) reportError(error.message);
    else {
      setReconciliation(data);
      setMessage("Shift closed and reconciliation saved to the audit trail.");
      setCountedCash("");
      setClosingNotes("");
      router.refresh();
    }
    setBusy("");
  }

  return (
    <div className="space-y-6">
      {message && (
        <p role="status" className={`rounded-xl p-3 text-sm ${isError ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>
          {message}
        </p>
      )}

      <div className={cashierOnly ? "grid gap-5" : "grid gap-5 xl:grid-cols-2"}>
        {!cashierOnly && <section className="rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft">
          <h2 className="font-semibold text-forest">Record an expense request</h2>
          <p className="mt-1 text-xs text-gray-500">New requests remain pending until reviewed by the owner.</p>
          <form onSubmit={submitExpense} className="mt-4 space-y-3">
            <input required value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="Expense title" className="w-full rounded-lg border border-gray-200 p-3 text-sm" />
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} rows={2} placeholder="Purpose or details (optional)" className="w-full rounded-lg border border-gray-200 p-3 text-sm" />
            <div className="grid gap-3 sm:grid-cols-2">
              <input required type="number" min="1" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Amount (UGX)" className="min-w-0 rounded-lg border border-gray-200 p-3 text-sm" />
              <select value={category} onChange={(event) => setCategory(event.target.value)} className="rounded-lg border border-gray-200 p-3 text-sm">
                <option value="supplies">Supplies</option>
                <option value="maintenance">Maintenance</option>
                <option value="utilities">Utilities</option>
                <option value="payroll">Payroll</option>
                <option value="food_and_beverage">Food & beverage</option>
                <option value="transport">Transport</option>
                <option value="other">Other</option>
              </select>
              <select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} className="rounded-lg border border-gray-200 p-3 text-sm">
                <option value="">No department</option>
                {departmentOptions.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
              </select>
              <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} className="rounded-lg border border-gray-200 p-3 text-sm">
                <option value="cash">Cash</option>
                <option value="mobile_money">Mobile money</option>
                <option value="bank_transfer">Bank transfer</option>
                <option value="card">Card</option>
                <option value="pesapal">Pesapal</option>
              </select>
            </div>
            <button disabled={!!busy} className="w-full rounded-xl bg-forest px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">
              {busy === "expense" ? "Submitting…" : "Submit for approval"}
            </button>
          </form>
        </section>}

        <section className="rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft">
          <h2 className="font-semibold text-forest">Cashier shift control</h2>
          <p className="mt-1 text-xs text-gray-500">Open a shift with its starting float, then close it against the physical cash counted.</p>
          {openSession ? (
            <form onSubmit={closeShift} className="mt-4 space-y-3">
              <div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">
                <p className="font-semibold">Your shift is open</p>
                <p className="mt-1 text-xs">Opened {new Date(openSession.opened_at).toLocaleString("en-UG", { timeZone: "Africa/Kampala" })}</p>
                <p className="mt-2">Opening float: <b>{money(openSession.opening_float)}</b></p>
              </div>
              <input required type="number" min="0" step="1" value={countedCash} onChange={(event) => setCountedCash(event.target.value)} placeholder="Physical cash counted (UGX)" className="w-full rounded-lg border border-gray-200 p-3 text-sm" />
              <textarea value={closingNotes} onChange={(event) => setClosingNotes(event.target.value)} maxLength={500} rows={2} placeholder="Closing notes (optional)" className="w-full rounded-lg border border-gray-200 p-3 text-sm" />
              <button disabled={!!busy} className="w-full rounded-xl bg-forest px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">
                {busy === "close" ? "Reconciling…" : "Close shift & reconcile"}
              </button>
            </form>
          ) : (
            <form onSubmit={openShift} className="mt-4 space-y-3">
              <label className="block text-xs font-medium text-gray-600">Opening cash float (UGX)</label>
              <input required type="number" min="0" step="1" value={openingFloat} onChange={(event) => setOpeningFloat(event.target.value)} className="w-full rounded-lg border border-gray-200 p-3 text-sm" />
              <button disabled={!!busy} className="w-full rounded-xl bg-forest px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">
                {busy === "open" ? "Opening shift…" : "Open cashier shift"}
              </button>
            </form>
          )}
        </section>
      </div>

      {reconciliation && (
        <section className="rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft">
          <h2 className="font-semibold text-forest">Latest shift reconciliation</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <div><p className="text-xs text-gray-500">Opening float</p><b>{money(reconciliation.opening_float)}</b></div>
            <div><p className="text-xs text-gray-500">Cash sales</p><b>{money(reconciliation.cash_sales)}</b></div>
            <div><p className="text-xs text-gray-500">Non-cash sales</p><b>{money(reconciliation.non_cash_sales)}</b></div>
            <div><p className="text-xs text-gray-500">Cash expenses</p><b>{money(reconciliation.cash_expenses)}</b></div>
            <div><p className="text-xs text-gray-500">Expected cash</p><b>{money(reconciliation.expected_cash)}</b></div>
            <div><p className="text-xs text-gray-500">Variance</p><b className={reconciliation.variance === 0 ? "text-emerald-700" : "text-rose-700"}>{money(reconciliation.variance)}</b></div>
          </div>
          <p className="mt-3 text-xs text-gray-500">Variance = physical cash counted minus expected cash. A negative figure indicates a shortage; a positive figure indicates an overage.</p>
        </section>
      )}

      {!cashierOnly && !managerMode && (
        <>
          <section className="rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft">
            <h2 className="font-semibold text-forest">Approved expenses awaiting payment</h2>
            <p className="mt-1 text-xs text-gray-500">Approval does not mean money has been paid. Record the actual payment method when the expense is settled.</p>
            {!payableExpenses.length ? (
              <p className="py-6 text-center text-sm text-gray-400">No approved expenses are awaiting payment.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {payableExpenses.map((expense) => (
                  <div key={expense.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-100 p-3">
                    <div>
                      <p className="font-medium text-forest">{expense.title}</p>
                      <p className="text-xs text-gray-500">{money(expense.amount)} · {expense.category.replaceAll("_", " ")}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <select value={expensePaymentMethods[expense.id] || "cash"} onChange={(event) => setExpensePaymentMethods((current) => ({ ...current, [expense.id]: event.target.value }))} className="rounded-lg border border-gray-200 p-2 text-sm">
                        <option value="cash">Cash</option>
                        <option value="mobile_money">Mobile money</option>
                        <option value="bank_transfer">Bank transfer</option>
                        <option value="card">Card</option>
                        <option value="pesapal">Pesapal</option>
                      </select>
                      <button type="button" disabled={!!busy} onClick={() => markExpensePaid(expense.id)} className="rounded-lg bg-forest px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
                        {busy === "pay-expense-" + expense.id ? "Saving…" : "Mark paid"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-forest">Expense approvals</h2>
                <p className="mt-1 text-xs text-gray-500">Only the owner can approve or reject a pending request.</p>
              </div>
              <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">{pendingExpenses.length} pending</span>
            </div>
            {!pendingExpenses.length ? (
              <p className="py-8 text-center text-sm text-gray-400">No expense requests are waiting for approval.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {pendingExpenses.map((expense) => (
                  <article key={expense.id} className="rounded-xl border border-gray-100 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-forest">{expense.title}</p>
                        {expense.description && <p className="mt-1 text-sm text-gray-500">{expense.description}</p>}
                        <p className="mt-1 text-xs text-gray-400">{expense.category.replaceAll("_", " ")} · {new Date(expense.created_at).toLocaleDateString("en-UG")}</p>
                      </div>
                      <b className="whitespace-nowrap">{money(expense.amount)}</b>
                    </div>
                    <input value={rejectionReasons[expense.id] || ""} onChange={(event) => setRejectionReasons((current) => ({ ...current, [expense.id]: event.target.value }))} placeholder="Reason required only if rejecting" maxLength={500} className="mt-3 w-full rounded-lg border border-gray-200 p-2.5 text-sm" />
                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                      <button type="button" disabled={!!busy} onClick={() => reviewExpense(expense.id, "rejected")} className="rounded-lg border border-rose-200 px-4 py-2 text-sm font-medium text-rose-700 disabled:opacity-50">Reject</button>
                      <button type="button" disabled={!!busy} onClick={() => reviewExpense(expense.id, "approved")} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy === expense.id ? "Saving…" : "Approve"}</button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
