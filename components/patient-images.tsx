"use client";
/* eslint-disable @next/next/no-img-element -- Clinical image routes are authenticated and must load with the browser session. */
import { useRef, useState } from "react";
import { FileText, ImagePlus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ClinicalImage } from "@/app/clinical-data";

const MAX_SIZE = 12 * 1024 * 1024;
const MAX_IMAGES = 12;
const formats = ["image/jpeg","image/png","image/webp","application/pdf"];

export function PatientImages({images,onAdd,onRemove}:{images:ClinicalImage[];onAdd:(files:File[],kind:ClinicalImage["kind"],note:string)=>Promise<void>;onRemove:(id:number)=>Promise<void>}) {
  const inputRef=useRef<HTMLInputElement|null>(null);
  const [kind,setKind]=useState<ClinicalImage["kind"]>("Radiografía"),[note,setNote]=useState(""),[error,setError]=useState(""),[open,setOpen]=useState<ClinicalImage|null>(null);
  const chooseFiles=async(selected:FileList|null)=>{
    if(!selected?.length)return;
    const files=Array.from(selected);
    if(images.length+files.length>MAX_IMAGES){setError(`Máximo ${MAX_IMAGES} imágenes por paciente.`);return}
    if(files.some(file=>!formats.includes(file.type))){setError("Selecciona archivos JPG, PNG, WebP o PDF. Las series DICOM no se admiten.");return}
    if(files.some(file=>file.size>MAX_SIZE)){setError("Cada archivo debe pesar menos de 12 MB.");return}
    try { await onAdd(files,kind,note.trim());setNote("");setError(""); } catch(e) { setError(e instanceof Error?e.message:"No se pudieron guardar las imágenes."); }
  };
  return <div className="surface space-y-5"><div><h3 className="font-semibold">Imágenes y documentos clínicos</h3><p className="mt-1 text-sm text-[#60757a]">Adjunta radiografías, capturas seleccionadas del cone beam o documentos PDF a este paciente.</p></div>
    <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]"><label className="text-sm font-medium">Tipo<select value={kind} onChange={e=>setKind(e.target.value as ClinicalImage["kind"])} className="mt-1 block h-10 w-full rounded-lg border border-[#dce5e7] bg-white px-2"><option>Radiografía</option><option>Captura CBCT</option></select></label><label className="text-sm font-medium">Descripción (opcional)<Input value={note} onChange={e=>setNote(e.target.value)} className="mt-1" placeholder="Ej. corte sagital, zona 3.6"/></label></div>
    <input ref={inputRef} type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf,.pdf" className="sr-only" aria-label="Seleccionar imágenes o documentos clínicos" onChange={e=>{void chooseFiles(e.target.files);e.target.value=""}}/><Button type="button" variant="outline" onClick={()=>inputRef.current?.click()}><ImagePlus className="mr-2 size-4"/>Seleccionar archivos</Button>
    <p className="text-xs leading-5 text-[#60757a]">JPG, PNG, WebP o PDF; hasta 12 MB por archivo y 12 archivos por paciente. No se carga el volumen CBCT completo. Las capturas no sustituyen el estudio original para diagnóstico.</p>
    {error&&<p role="alert" className="text-sm font-medium text-[#a43542]">{error}</p>}
    {images.length?<div className="grid gap-3 sm:grid-cols-2">{images.map(img=>{const isPdf=img.contentType==="application/pdf"||img.name.toLowerCase().endsWith(".pdf");return <div key={img.id} className="overflow-hidden rounded-xl border border-[#dce5e7]"><button type="button" className="flex h-44 w-full items-center justify-center gap-3 bg-[#edf3f3] text-[#315963]" onClick={()=>setOpen(img)} aria-label={`Abrir ${img.name}`}>{isPdf?<><FileText className="size-10"/><span className="font-semibold">Ver PDF</span></>:<img src={img.url} alt={img.note||`${img.kind}: ${img.name}`} className="h-44 w-full object-contain"/>}</button><div className="space-y-1 p-3"><p className="truncate text-sm font-semibold">{img.name}</p><p className="text-xs text-[#60757a]">{img.kind} · {(img.size/1024/1024).toFixed(1)} MB · {img.addedAt}</p>{img.note&&<p className="text-sm text-[#53686e]">{img.note}</p>}<Button type="button" variant="ghost" size="sm" className="mt-1 text-[#a43542]" onClick={()=>{void onRemove(img.id).catch(e=>setError(e instanceof Error?e.message:"No se pudo quitar el archivo."))}}><Trash2 className="mr-1 size-4"/>Quitar archivo</Button></div></div>})}</div>:<p className="rounded-xl border border-dashed border-[#dce5e7] p-5 text-center text-sm text-[#71858b]">Aún no hay imágenes ni documentos de este paciente.</p>}
    {open&&<div role="dialog" aria-modal="true" aria-label={open.name} className="fixed inset-0 z-[70] flex flex-col bg-[#102e37]/95 p-4 text-white"><div className="mb-3 flex items-center justify-between gap-3"><div><strong>{open.kind}</strong><p className="text-sm text-[#d2e1e3]">{open.name}</p></div><button type="button" className="rounded-lg p-2 hover:bg-white/10" aria-label="Cerrar archivo" onClick={()=>setOpen(null)}><X/></button></div>{open.contentType==="application/pdf"||open.name.toLowerCase().endsWith(".pdf")?<iframe src={open.url} title={open.name} className="min-h-0 flex-1 rounded-lg bg-white"/>:<img src={open.url} alt={open.note||open.name} className="min-h-0 flex-1 object-contain"/>}{open.note&&<p className="mt-3 text-sm">{open.note}</p>}</div>}
  </div>;
}
