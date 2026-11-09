import {redirect} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
import {InventoryWorkspace} from "@/components/inventory-workspace";
export const dynamic="force-dynamic";
export default async function ManagerInventoryPage(){
 const db=await createClient();const {data:{user}}=await db.auth.getUser();if(!user)redirect("/login");
 const {data:profile}=await db.from("profiles").select("role,department_id,departments(name,slug)").eq("id",user.id).single();
 if(profile?.role!=="manager"||!profile.department_id)redirect("/manager/dashboard");
 const [departments,items,suppliers,purchases,transfers,stocktakes,movements]=await Promise.all([
  db.from("departments").select("id,name,slug").eq("id",profile.department_id),
  db.from("inventory_items").select("id,name,department_id,quantity,unit,low_stock_threshold,sku,category,unit_cost,storage_location,is_active").eq("department_id",profile.department_id).eq("is_active",true).order("name"),
  db.from("inventory_suppliers").select("id,name,contact_person,phone,email,is_active").eq("is_active",true).order("name"),
  db.from("inventory_purchase_orders").select("*,inventory_suppliers(name),inventory_purchase_order_items(id,inventory_item_id,quantity_ordered,quantity_received,unit_cost,inventory_items(name,unit))").eq("department_id",profile.department_id).order("created_at",{ascending:false}).limit(100),
  db.from("inventory_transfers").select("*").order("created_at",{ascending:false}).limit(100),
  db.from("inventory_stocktakes").select("*,inventory_stocktake_lines(id,inventory_item_id,system_quantity,counted_quantity,inventory_items(name,unit))").eq("department_id",profile.department_id).order("created_at",{ascending:false}).limit(50),
  db.from("inventory_movements").select("*,inventory_items(name,unit)").eq("department_id",profile.department_id).order("created_at",{ascending:false}).limit(200)
 ]);
 const failed=[departments,items,suppliers,purchases,transfers,stocktakes,movements].some(x=>x.error);
 const dept=profile.departments as unknown as {name:string;slug:string}|null;
 return <main className="space-y-6"><header><p className="text-xs font-bold tracking-widest text-gold">DEPARTMENT WORKSPACE</p><h1 className="mt-2 text-3xl font-semibold text-forest">Inventory & stores</h1><p className="mt-2 text-sm text-gray-500">{dept?.name||"Your department"} · Request stock purchases, receive approved deliveries, record wastage and conduct stocktakes.</p><a href="/manager/inventory/invoices" className="mt-3 inline-flex rounded-lg border border-forest px-4 py-2 text-sm font-semibold text-forest">Supplier invoices</a></header>{failed&&<div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Some inventory data is unavailable. The administrator must apply Supabase migration 0022_inventory_management.sql after migrations 0001–0021.</div>}<InventoryWorkspace role="manager" userId={user.id} departmentId={profile.department_id} departments={(departments.data||[]) as any} items={(items.data||[]) as any} suppliers={(suppliers.data||[]) as any} purchaseOrders={(purchases.data||[]) as any} transfers={(transfers.data||[]) as any} stocktakes={(stocktakes.data||[]) as any} movements={(movements.data||[]) as any}/></main>;
}