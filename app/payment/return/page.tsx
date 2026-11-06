import Link from "next/link";
import { BrandMark } from "@/components/brand";
export default function PaymentReturn({ searchParams }: { searchParams: { cancelled?: string; OrderTrackingId?: string } }) {
  return <main className="grid min-h-screen place-items-center bg-cream px-5"><section className="w-full max-w-lg rounded-2xl bg-white p-8 text-center shadow-soft">
    <div className="mb-5 flex justify-center"><BrandMark size={76} /></div>
    <p className="text-xs font-bold tracking-widest text-gold">PAYMENT UPDATE</p>
    <h1 className="mt-3 text-2xl font-semibold text-forest">{searchParams.cancelled ? "Payment not completed" : "Thank you for your payment attempt"}</h1>
    <p className="mt-3 text-sm leading-6 text-gray-500">Pesapal sends payment updates separately. Reception verifies the transaction before marking your booking deposit as paid. If you need help, call 0772509759.</p>
    <Link href="/" className="mt-6 inline-block rounded-xl bg-forest px-5 py-3 font-semibold text-white">Return to hotel website</Link>
  </section></main>;
}
