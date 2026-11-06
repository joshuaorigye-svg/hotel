import {redirect} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
import {DepartmentOperations} from "@/components/department-operations";
export const dynamic="force-dynamic";
export default async function ManagerOperations(){
 const db=await createClient();const {data:{user}}=await db.auth.getUser();if(!user)redirect("/login");
 const {data:p}=await db.from("profiles").select("role,department_id,departments(slug,name)").eq("id",user.id).single();
 if(p?.role!=="manager"||!p.department_id)redirect("/manager/dashboard");
 const department=p.departments as unknown as {slug:string;name:string}|null;
 if(department?.slug==="housekeeping"){
  const {data}=await db.from("rooms").select("id,room_number,room_type,status").eq("is_active",true).order("room_number");
  return <main className="space-y-5"><header><p className="text-xs font-bold tracking-widest text-gold">HOUSEKEEPING</p><h1 className="mt-2 text-3xl font-semibold text-forest">Room turnover</h1><p className="mt-2 text-sm text-gray-500">Update room readiness as cleaning progresses. Checked-in rooms cannot be marked available.</p></header><DepartmentOperations kind="housekeeping" rooms={data||[]} issues={[]}/></main>;
 }
 if(department?.slug==="maintenance-cleaning"){
  const {data}=await db.from("issue_reports").select("id,title,description,status,created_at,room_id").eq("assigned_department_id",p.department_id).order("created_at",{ascending:false}).limit(100);
  return <main className="space-y-5"><header><p className="text-xs font-bold tracking-widest text-gold">MAINTENANCE</p><h1 className="mt-2 text-3xl font-semibold text-forest">Issue desk</h1><p className="mt-2 text-sm text-gray-500">Review reported problems and keep each issue's progress up to date.</p></header><DepartmentOperations kind="maintenance" rooms={[]} issues={data||[]}/></main>;
 }
 redirect("/manager/dashboard");
}
