"use client";

import {useState} from "react";
import {createClient} from "@/lib/supabase/client";

type Evidence={
 id:string;
 file_name:string;
 mime_type:string;
 size_bytes:number;
 document_type:"invoice"|"delivery_note"|"receipt"|"other";
 storage_path:string;
 created_at:string;
};

const labels:Record<Evidence["document_type"],string>={
 invoice:"Supplier invoice",
 delivery_note:"Delivery note",
 receipt:"Receipt",
 other:"Other"
};

export function SupplierInvoiceDocuments({
 invoiceId,
 status,
 role,
 documents
}:{
 invoiceId:string;
 status:string;
 role:"owner"|"manager";
 documents:Evidence[];
}){
 const db=createClient();
 const [file,setFile]=useState<File|null>(null);
 const [kind,setKind]=useState<Evidence["document_type"]>("invoice");
 const [busy,setBusy]=useState("");
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const [opening,setOpening]=useState("");
 const [downloadUrl,setDownloadUrl]=useState<Record<string,string>>({});
 const canUpload=role==="owner"||["pending","rejected"].includes(status);

 async function upload(){
  if(!file)return;
  setBusy("upload");setError("");setNotice("");
  const allowed=["application/pdf","image/jpeg","image/png","image/webp"];
  if(!allowed.includes(file.type)){setError("Choose a PDF, JPG, PNG or WEBP file.");setBusy("");return;}
  if(file.size<=0||file.size>10*1024*1024){setError("The file must be smaller than 10 MB.");setBusy("");return;}
  const extension=file.name.split(".").pop()?.toLowerCase()||"";
  if(!["pdf","jpg","jpeg","png","webp"].includes(extension)){setError("The file extension is not supported.");setBusy("");return;}
  const path=invoiceId+"/"+crypto.randomUUID()+"."+extension;
  const {error:uploadError}=await db.storage.from("supplier-invoice-documents").upload(path,file,{contentType:file.type,upsert:false});
  if(uploadError){setError(uploadError.message);setBusy("");return;}
  const {error:registerError}=await db.rpc("register_supplier_invoice_document",{
   p_invoice_id:invoiceId,
   p_storage_path:path,
   p_file_name:file.name,
   p_mime_type:file.type,
   p_size_bytes:file.size,
   p_document_type:kind
  });
  if(registerError){
   await db.storage.from("supplier-invoice-documents").remove([path]);
   setError(registerError.message);
  }else{
   setNotice("Supporting document uploaded securely.");
   setFile(null);
   const input=document.getElementById("supplier-evidence-"+invoiceId) as HTMLInputElement|null;
   if(input)input.value="";
   window.location.reload();
  }
  setBusy("");
 }

 async function openDocument(doc:Evidence){
  setOpening(doc.id);setError("");
  const {data,error}=await db.storage.from("supplier-invoice-documents").createSignedUrl(doc.storage_path,60);
  if(error)setError(error.message);
  else if(data?.signedUrl)setDownloadUrl(s=>({...s,[doc.id]:data.signedUrl}));
  setOpening("");
 }

 return <div className="mt-3 rounded-xl bg-gray-50 p-3">
  <div className="flex flex-wrap items-center justify-between gap-2">
   <p className="text-xs font-semibold text-forest">Supporting documents ({documents.length})</p>
   <p className="text-[11px] text-gray-500">Private files · PDF/JPG/PNG/WEBP · max 10 MB</p>
  </div>
  {documents.length>0&&<ul className="mt-2 space-y-2">
   {documents.map(doc=><li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-white px-3 py-2">
    <div className="min-w-0"><p className="truncate text-xs font-medium text-gray-800">{doc.file_name}</p><p className="text-[11px] text-gray-400">{labels[doc.document_type]} · {(Number(doc.size_bytes)/1024/1024).toFixed(2)} MB · {new Date(doc.created_at).toLocaleDateString("en-UG")}</p></div>
    {downloadUrl[doc.id]?<a href={downloadUrl[doc.id]} target="_blank" rel="noreferrer" className="text-xs font-semibold text-forest underline">Open file</a>:<button type="button" onClick={()=>openDocument(doc)} disabled={opening===doc.id} className="text-xs font-semibold text-forest underline disabled:opacity-50">{opening===doc.id?"Preparing…":"View securely"}</button>}
   </li>)}
  </ul>}
  {canUpload?<div className="mt-3 flex flex-wrap items-end gap-2">
   <label className="grid gap-1 text-[11px] text-gray-500">Choose document
    <input id={"supplier-evidence-"+invoiceId} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" onChange={e=>setFile(e.target.files?.[0]||null)} className="max-w-[230px] text-xs file:mr-2 file:rounded-lg file:border-0 file:bg-white file:px-2 file:py-1.5 file:text-xs"/>
   </label>
   <label className="grid gap-1 text-[11px] text-gray-500">Document type
    <select value={kind} onChange={e=>setKind(e.target.value as Evidence["document_type"])} className="rounded-lg border bg-white p-2 text-xs">{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
   </label>
   <button type="button" disabled={!file||!!busy} onClick={upload} className="rounded-lg bg-forest px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy==="upload"?"Uploading…":"Upload document"}</button>
  </div>:<p className="mt-2 text-[11px] text-gray-500">This invoice is no longer open for department uploads. An owner can still attach supporting evidence.</p>}
  {(error||notice)&&<p role={error?"alert":"status"} className={error?"mt-2 text-xs text-rose-700":"mt-2 text-xs text-emerald-700"}>{error||notice}</p>}
 </div>;
}
