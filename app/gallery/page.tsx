import Link from "next/link";
import { BrandMark } from "@/components/brand";
export default function Gallery() {
  return <main className="min-h-screen bg-cream"><header className="bg-white px-5 py-3"><Link href="/" className="flex items-center gap-3 font-semibold text-forest"><BrandMark size={48} /><span>Buladde Palm Villa Hotel</span></Link></header>
    <section className="mx-auto max-w-6xl px-5 py-12"><p className="text-xs font-bold tracking-widest text-gold">A GLIMPSE OF THE HOTEL</p><h1 className="mt-2 text-3xl font-semibold text-forest">Gallery</h1><p className="mt-3 text-sm text-gray-500">Hotel photographs will be added by the owner. We do not display stock photos as actual hotel facilities.</p><div className="mt-8 rounded-2xl border border-dashed border-[#C6A15B] bg-white p-12 text-center text-sm text-gray-400">Official hotel gallery coming soon.</div></section></main>;
}
