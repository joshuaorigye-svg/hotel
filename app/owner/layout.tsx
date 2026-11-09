import {redirect} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
import {OwnerShell} from "@/components/owner-shell";
export const dynamic="force-dynamic";
export default async function OwnerLayout({children}:{children:React.ReactNode}){
 const supabase=await createClient();
 const {data:{user}}=await supabase.auth.getUser();
 if(!user)redirect("/login");
 const {data:profile}=await supabase.from("profiles").select("full_name,role").eq("id",user.id).single();
 if(profile?.role!=="owner")redirect(profile?.role==="manager"?"/manager/dashboard":"/staff/tasks");
 const {data:notifications}=await supabase.from("user_notifications").select("id,title,message,href,read_at,created_at").eq("user_id",user.id).order("created_at",{ascending:false}).limit(8);
 return <OwnerShell ownerName={profile.full_name||user.email||"Owner"} notifications={notifications||[]}>{children}</OwnerShell>;
}