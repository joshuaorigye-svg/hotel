"use client";
export function ReportExport({rows,filename}:{rows:(string[]|undefined)[];filename:string}) {
 function download(){const csv=rows.map(row=>(row||[]).map(value=>{const text=String(value??"");return '"'+text.replace(/"/g,'""')+'"';}).join(",")).join("\r\n");const blob=new Blob(["\uFEFF",csv],{type:"text/csv;charset=utf-8;"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);}
 return <button onClick={download} className="rounded-xl bg-forest px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-900">Export report CSV</button>;
}
