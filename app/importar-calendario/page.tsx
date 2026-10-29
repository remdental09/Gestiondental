"use client";
import { useState } from "react";
import Link from "next/link";

type CalendarItem = { eventId:string; title:string; startAt:string; endAt:string; htmlLink?:string; status?:string };
type CalendarBatch = { calendarId:string; events:CalendarItem[] };

export default function ImportarCalendario() {
  const [batch,setBatch]=useState<CalendarBatch|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  async function select(file?:File) {
    setBatch(null);setError("");setMessage("");
    if(!file)return;
    try {
      if(file.size>200000)throw new Error("Archivo demasiado grande.");
      const data=JSON.parse(await file.text()) as CalendarBatch;
      if(!data||typeof data.calendarId!=="string"||!Array.isArray(data.events)||data.events.length<1||data.events.length>250)throw new Error("Archivo de citas inválido.");
      setBatch(data);
    }catch(e){setError(e instanceof Error?e.message:"No se pudo abrir el archivo.");}
  }
  async function save() {
    if(!batch)return;
    setBusy(true);setError("");setMessage("");
    try {
      const response=await fetch("/api/clinical",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"importCalendarEvents",...batch})});
      const result=await response.json() as {error?:string;count?:number;imported?:boolean};
      if(!response.ok||!result.imported)throw new Error(result.error||"No se pudieron guardar las citas.");
      setMessage(String(result.count)+" citas verificadas en la ficha. Abre Agenda para ver la semana.");
      setBatch(null);
    }catch(e){setError(e instanceof Error?e.message:"No se pudo importar.");}
    finally{setBusy(false);}
  }
  return <main className="mx-auto max-w-3xl p-6 text-[#20343b]">
    <Link href="/" className="text-sm text-[#087f83] underline">Volver a la ficha</Link>
    <h1 className="mt-8 text-3xl font-semibold">Importar citas de Google Calendar</h1>
    <p className="mt-3 text-sm text-[#60757a]">Selecciona el archivo de citas preparado para esta semana. Las citas se guardan en tu agenda privada; repetir la importación actualiza sus horarios.</p>
    <section className="mt-5 rounded-xl border border-[#c8d6d9] bg-white p-5">
      <label htmlFor="calendar-file" className="text-sm font-semibold">Archivo de calendario</label>
      <input id="calendar-file" type="file" accept=".json,application/json" className="mt-3 block w-full text-sm" disabled={busy} onChange={e=>{void select(e.target.files?.[0]);e.target.value=""}}/>
      {batch&&<><p className="mt-4 text-sm">{batch.events.length} citas listas para importar:</p><ul className="mt-2 space-y-1 text-sm">{batch.events.map(e=><li key={e.eventId}>{e.title} · {new Intl.DateTimeFormat("es-CL",{dateStyle:"short",timeStyle:"short",timeZone:"America/Santiago"}).format(new Date(e.startAt))}</li>)}</ul><button type="button" disabled={busy} onClick={()=>void save()} className="mt-5 rounded-lg bg-[#087f83] px-5 py-3 font-medium text-white disabled:opacity-50">{busy?"Guardando...":"Guardar citas"}</button></>}
      {error&&<p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      {message&&<p role="status" className="mt-3 text-sm text-[#087f83]">{message}</p>}
    </section>
  </main>;
}