import {redirect} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
import {SupplierInvoiceWorkspace} from "@/components/supplier-invoice-workspace";
export const dynamic="force-dynamic";
export default async function ManagerSupplierInvoicesPage(){
 const db=await createClient();
 const {data:{user}}=await db.auth.getUser();
 if(!user)redirect("/login");
 const {data:profile}=await db.from("profiles").select("role,department_id").eq("id",user.id).single();
 if(profile?.role!=="manager"||!profile.department_id)redirect("/manager/dashboard");
 const [orders,invoices]=await Promise.all([
  db.from("inventory_purchase_orders").select("id,order_number,department_id,status,inventory_suppliers(name),inventory_purchase_order_items(id,inventory_item_id,quantity_ordered,quantity_received,quantity_invoiced,unit_cost,inventory_items(name,unit))").eq("department_id",profile.department_id).in("status",["partially_received","received"]).order("created_at",{ascending:false}).limit(200),
  db.from("inventory_supplier_invoices").select("*,inventory_suppliers(name),inventory_purchase_orders(order_number),inventory_supplier_invoice_lines(id,quantity,unit_price,line_total,inventory_items(name,unit)),inventory_supplier_invoice_documents(id,file_name,mime_type,size_bytes,document_type,storage_path,created_at)").eq("department_id",profile.department_id).order("created_at",{ascending:false}).limit(200)
 ]);
 const failed=orders.error||invoices.error;
 return <main className="space-y-6"><header className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-bold tracking-widest text-gold">DEPARTMENT WORKSPACE</p><h1 className="mt-2 text-3xl font-semibold text-forest">Supplier invoices</h1><p className="mt-2 text-sm text-gray-500">Record supplier invoices against received deliveries and follow their approval status.</p></div><a href="/manager/inventory" className="rounded-lg border px-4 py-2 text-sm font-medium text-forest">Back to inventory</a></header>{failed&&<div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Supplier invoice data is unavailable. The administrator must apply migration 0023_supplier_invoice_reconciliation.sql after migrations 0001–0022.</div>}<SupplierInvoiceWorkspace role="manager" purchaseOrders={(orders.data||[]) as any} invoices={(invoices.data||[]) as any}/></main>;
}
