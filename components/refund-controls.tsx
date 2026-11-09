"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type PaymentOption = {
  id: string;
  amount: number | string;
  payment_method: string | null;
  created_at: string;
  booking_id: string | null;
};
type RefundRequest = {
  id: string;
  payment_id: string;
  amount: number | string;
  reason: string;
  status: "pending" | "approved" | "rejected" | "processed";
  requested_by: string;
  created_at: string;
  rejection_reason: string | null;
  refund_reference: string | null;
};

const money = (value: number | string) =>
  new Intl.NumberFormat("en-UG", {
    style: "currency",
    currency: "UGX",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);

export function RefundControls({
  ownerMode,
  payments,
  requests,
}: {
  ownerMode: boolean;
  payments: PaymentOption[];
  requests: RefundRequest[];
}) {
  const db = createClient();
  const router = useRouter();
  const [paymentId, setPaymentId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [rejectionReasons, setRejectionReasons] = useState<Record<string, string>>({});
  const [references, setReferences] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  async function requestRefund(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("request");
    setMessage("");
    setErrorMessage("");
    const numericAmount = Number(amount);
    if (!paymentId || !Number.isSafeInteger(numericAmount) || numericAmount <= 0 || reason.trim().length < 5) {
      setErrorMessage("Choose a payment, enter a whole UGX amount, and provide a reason of at least five characters.");
      setBusy("");
      return;
    }
    const { error } = await db.rpc("create_refund_request", {
      p_payment_id: paymentId,
      p_amount: numericAmount,
      p_reason: reason.trim(),
    });
    if (error) setErrorMessage(error.message);
    else {
      setMessage("Refund request submitted for owner review. No money has been sent.");
      setPaymentId("");
      setAmount("");
      setReason("");
      router.refresh();
    }
    setBusy("");
  }

  async function review(id: string, decision: "approved" | "rejected") {
    setBusy(id);
    setMessage("");
    setErrorMessage("");
    const rejection = rejectionReasons[id] || "";
    if (decision === "rejected" && rejection.trim().length < 5) {
      setErrorMessage("Enter a clear rejection reason of at least five characters.");
      setBusy("");
      return;
    }
    const { error } = await db.rpc("review_refund_request", {
      p_refund_request_id: id,
      p_decision: decision,
      p_rejection_reason: decision === "rejected" ? rejection.trim() : null,
    });
    if (error) setErrorMessage(error.message);
    else {
      setMessage(decision === "approved"
        ? "Refund approved. It still needs to be processed through the original provider or bank."
        : "Refund request rejected.");
      router.refresh();
    }
    setBusy("");
  }

  async function markProcessed(id: string) {
    const reference = (references[id] || "").trim();
    if (reference.length < 3) {
      setErrorMessage("Enter the provider or bank reference after the refund has actually been completed.");
      return;
    }
    setBusy(id);
    setMessage("");
    setErrorMessage("");
    const { error } = await db.rpc("record_refund_processed", {
      p_refund_request_id: id,
      p_refund_reference: reference,
    });
    if (error) setErrorMessage(error.message);
    else {
      setMessage("Completed refund recorded with its external reference.");
      router.refresh();
    }
    setBusy("");
  }

  const paymentLabels = new Map(payments.map((payment) => [
    payment.id,
    `${payment.booking_id ? "Booking " + payment.booking_id.slice(0, 8) : "Payment " + payment.id.slice(0, 8)} · ${money(payment.amount)} · ${payment.payment_method || "method not recorded"} · ${new Date(payment.created_at).toLocaleDateString("en-UG")}`,
  ]));

  return (
    <section className="rounded-2xl border border-[#EAE6DC] bg-white p-5 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-forest">Refund control</h2>
          <p className="mt-1 text-xs text-gray-500">
            {ownerMode
              ? "Review requests, approve or reject them, then record the external refund reference once funds have actually been returned."
              : "Submit a refund request for a completed guest payment. The owner must approve it."}
          </p>
        </div>
        {ownerMode && <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">{requests.filter((item) => item.status === "pending").length} awaiting review</span>}
      </div>

      {(message || errorMessage) && (
        <p role="status" className={errorMessage ? "mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700" : "mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800"}>
          {errorMessage || message}
        </p>
      )}

      <form onSubmit={requestRefund} className="mt-5 grid gap-3 md:grid-cols-2">
        <label className="text-sm text-gray-600">
          Completed payment
          <select value={paymentId} onChange={(event) => setPaymentId(event.target.value)} required className="mt-1 w-full rounded-lg border border-gray-200 bg-white p-2.5">
            <option value="">Select payment</option>
            {payments.map((payment) => <option key={payment.id} value={payment.id}>{paymentLabels.get(payment.id)}</option>)}
          </select>
        </label>
        <label className="text-sm text-gray-600">
          Refund amount (UGX)
          <input type="number" min="1" step="1" inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} required className="mt-1 w-full rounded-lg border border-gray-200 p-2.5" placeholder="e.g. 50000" />
        </label>
        <label className="text-sm text-gray-600 md:col-span-2">
          Reason for refund
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={5} maxLength={1000} required rows={2} className="mt-1 w-full rounded-lg border border-gray-200 p-2.5" placeholder="Explain why the guest is due a refund" />
        </label>
        <div className="md:col-span-2">
          <button type="submit" disabled={!!busy || payments.length === 0} className="rounded-lg bg-forest px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
            {busy === "request" ? "Submitting…" : "Submit refund request"}
          </button>
          {payments.length === 0 && <p className="mt-2 text-xs text-gray-400">No completed payments are currently available to request a refund against.</p>}
        </div>
      </form>

      {ownerMode && (
        <div className="mt-6">
          <h3 className="font-semibold text-forest">Refund request register</h3>
          {requests.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-400">No refund requests have been submitted.</p>
          ) : (
            <div className="mt-3 space-y-3">
              {requests.map((item) => (
                <article key={item.id} className="rounded-xl border border-gray-100 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-forest">{money(item.amount)} · {paymentLabels.get(item.payment_id) || "Payment " + item.payment_id.slice(0, 8)}</p>
                      <p className="mt-1 text-sm text-gray-600">{item.reason}</p>
                      <p className="mt-1 text-xs text-gray-400">Requested {new Date(item.created_at).toLocaleString("en-UG")} · Staff ID {item.requested_by.slice(0, 8)}</p>
                      {item.rejection_reason && <p className="mt-1 text-xs text-rose-700">Rejection: {item.rejection_reason}</p>}
                      {item.refund_reference && <p className="mt-1 text-xs text-emerald-700">External reference: {item.refund_reference}</p>}
                    </div>
                    <span className={item.status === "pending" ? "rounded-full bg-amber-50 px-2.5 py-1 text-xs text-amber-800" : item.status === "rejected" ? "rounded-full bg-rose-50 px-2.5 py-1 text-xs text-rose-700" : item.status === "processed" ? "rounded-full bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700" : "rounded-full bg-blue-50 px-2.5 py-1 text-xs text-blue-700"}>{item.status}</span>
                  </div>
                  {item.status === "pending" && (
                    <div className="mt-3">
                      <input value={rejectionReasons[item.id] || ""} onChange={(event) => setRejectionReasons((current) => ({ ...current, [item.id]: event.target.value }))} maxLength={500} placeholder="Reason required if rejecting" className="w-full rounded-lg border border-gray-200 p-2.5 text-sm" />
                      <div className="mt-2 flex justify-end gap-2">
                        <button type="button" disabled={!!busy} onClick={() => review(item.id, "rejected")} className="rounded-lg border border-rose-200 px-3 py-2 text-sm text-rose-700 disabled:opacity-50">Reject</button>
                        <button type="button" disabled={!!busy} onClick={() => review(item.id, "approved")} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy === item.id ? "Saving…" : "Approve"}</button>
                      </div>
                    </div>
                  )}
                  {item.status === "approved" && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <input value={references[item.id] || ""} onChange={(event) => setReferences((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="Actual provider/bank refund reference" className="min-w-0 flex-1 rounded-lg border border-gray-200 p-2.5 text-sm" />
                      <button type="button" disabled={!!busy} onClick={() => markProcessed(item.id)} className="rounded-lg bg-forest px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy === item.id ? "Saving…" : "Record completed refund"}</button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      )}
      <p className="mt-4 text-xs text-gray-400">This records approvals and completed refunds; it does not initiate a Pesapal, mobile-money or bank transfer. Only record a refund as processed after the provider confirms it.</p>
    </section>
  );
}
