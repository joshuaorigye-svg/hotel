import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { BrandMark } from "@/components/brand";
export const dynamic = "force-dynamic";
export default async function Restaurant() {
  const db = await createClient();
  const { data, error } = await db.from("restaurant_menu_items").select("id,name,description,category,price,image_url").eq("is_available", true).order("category").order("name");
  return <main className="min-h-screen bg-cream"><header className="flex items-center justify-between bg-white px-5 py-3"><Link href="/" className="flex items-center gap-3 font-semibold text-forest"><BrandMark size={48} /><span>Buladde Palm Villa Hotel</span></Link><Link href="/contact" className="text-sm font-semibold text-leaf">Contact reception</Link></header>
    <section className="mx-auto max-w-5xl px-5 py-12"><p className="text-xs font-bold tracking-widest text-gold">FRESHLY SERVED</p><h1 className="mt-2 text-3xl font-semibold text-forest">Restaurant & bar</h1><p className="mt-2 text-sm text-gray-500">Our current menu and prices.</p>
      {error ? <p className="mt-8 rounded-xl bg-amber-50 p-5 text-sm text-amber-800">Menu is temporarily unavailable.</p> : !data?.length ? <p className="mt-8 rounded-xl bg-white p-8 text-center text-sm text-gray-500">Menu items and prices will be published here. For enquiries, call 0772509759.</p> : <div className="mt-8 grid gap-3 md:grid-cols-2">{data.map((x: any) => <article key={x.id} className="flex items-start justify-between gap-4 rounded-2xl bg-white p-5 shadow-soft"><div><p className="text-xs font-semibold uppercase tracking-wider text-gold">{x.category}</p><h2 className="mt-1 font-semibold text-forest">{x.name}</h2><p className="mt-1 text-sm text-gray-500">{x.description}</p></div><b className="whitespace-nowrap text-sm text-forest">{Number(x.price).toLocaleString("en-UG")} UGX</b></article>)}</div>}
    </section></main>;
}
