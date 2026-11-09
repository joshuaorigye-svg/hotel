import {redirect} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
import {InventoryWorkspace} from "@/components/inventory-workspace";
export const dynamic="force-dynamic";
export default async function OwnerInventoryPage(){
 const db=await createClient();const {data:{user}}=await db.auth.getUser();if(!user)redirect("/login");
 const {data:profile}=await db.from("profiles").select("role").eq("id",user.id).single();if(profile?.role!=="owner")redirect("/staff/tasks");
 const [departments,items,suppliers,purchases,transfers,stocktakes,movements]=await Promise.all([
  db.from("departments").select("id,name,slug").eq("owner_only",false).order("name"),
  db.from("inventory_items").select("id,name,department_id,quantity,unit,low_stock_threshold,sku,category,unit_cost,storage_location,is_active").eq("is_active",true).order("name"),
  db.from("inventory_suppliers").select("id,name,contact_person,phone,email,is_active").order("name"),
  db.from("inventory_purchase_orders").select("*,inventory_suppliers(name),inventory_purchase_order_items(id,inventory_item_id,quantity_ordered,quantity_received,unit_cost,inventory_items(name,unit))").order("created_at",{ascending:false}).limit(100),
  db.from("inventory_transfers").select("*").order("created_at",{ascending:false}).limit(100),
  db.from("inventory_stocktakes").select("*,inventory_stocktake_lines(id,inventory_item_id,system_quantity,counted_quantity,inventory_items(name,unit))").order("created_at",{ascending:false}).limit(50),
  db.from("inventory_movements").select("*,inventory_items(name,unit)").order("created_at",{ascending:false}).limit(300)
 ]);
 const failed=[departments,items,suppliers,purchases,transfers,stocktakes,movements].some(x=>x.error);
 return <main className="space-y-6"><header><p className="text-xs font-bold tracking-widest text-gold">OWNER OFFICE</p><h1 className="mt-2 text-3xl font-semibold text-forest">Hotel inventory control</h1><p className="mt-2 text-sm text-gray-500">One stock register across departments, with purchasing approvals, transfers, physical counts and a traceable movement ledger.</p><a href="/owner/inventory/invoices" className="mt-3 inline-flex rounded-lg border border-forest px-4 py-2 text-sm font-semibold text-forest">Supplier invoices & payments</a></header>{failed&&<div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Some inventory data is unavailable. Apply Supabase migration 0022_inventory_management.sql after migrations 0001–0021, then reload this page. No sample stock figures are shown.</div>}<InventoryWorkspace role="owner" userId={user.id} departmentId={null} departments={(departments.data||[]) as any} items={(items.data||[]) as any} suppliers={(suppliers.data||[]) as any} purchaseOrders={(purchases.data||[]) as any} transfers={(transfers.data||[]) as any} stocktakes={(stocktakes.data||[]) as any} movements={(movements.data||[]) as any}/></main>;
}