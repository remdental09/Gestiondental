"use client";

import { useState } from "react";
import Link from "next/link";

type Preview = { name: string; patientAlreadyLinked: boolean; notesToCreate: number; notesAlreadyPresent: number; sameNameMatches: number };
type ImportCounts = { patientsCreated: number; notesCreated: number; patientsExisting: number; notesExisting: number };

export default function Importar() {
  const [payload, setPayload] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<Preview[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function changePayload(value: string) {
    setPayload(value); setPreview(null); setMessage(""); setError("");
  }

  async function loadFile(file?: File) {
    if (!file) return;
    setFileName(""); changePayload("");
    try {
      if (file.size > 250000) throw new Error("El archivo supera el máximo de 250 KB.");
      const value = await file.text();
      if (!Array.isArray(JSON.parse(value))) throw new Error("El archivo debe contener un lote de fichas.");
      changePayload(value); setFileName(file.name);
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo leer el archivo."); }
  }

  async function submit(confirmed: boolean) {
    setError(""); setMessage(""); setBusy(true);
    try {
      if (payload.length > 250000) throw new Error("El lote supera el máximo de 250 KB.");
      const records: unknown = JSON.parse(payload);
      if (!Array.isArray(records)) throw new Error("Selecciona un archivo con una lista de fichas.");
      const response = await fetch("/api/clinical", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: confirmed ? "importDriveRecords" : "previewDriveRecords", records }),
      });
      const result: { error?: string; preview?: Preview[]; result?: ImportCounts } = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo completar la operación.");
      if (!confirmed) {
        if (!result.preview) throw new Error("El servidor no devolvió una vista previa válida.");
        setPreview(result.preview); return;
      }
      if (!result.result) throw new Error("No se recibió la confirmación de la importación. Revisa las fichas antes de reintentar.");
      const counts = result.result;
      setMessage(`Importación verificada: ${counts.patientsCreated} pacientes y ${counts.notesCreated} evoluciones incorporadas. ${counts.patientsExisting} pacientes y ${counts.notesExisting} evoluciones ya estaban presentes.`);
      setPayload(""); setFileName(""); setPreview(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Error de importación."); }
    finally { setBusy(false); }
  }

  const ambiguous = preview?.some(item => item.sameNameMatches > 0) ?? false;
  return <main className="mx-auto max-w-3xl p-6 text-[#20343b]">
    <Link href="/" className="text-sm text-[#087f83] underline">← Volver a Pacientes</Link>
    <h1 className="mt-8 text-3xl font-semibold">Importar fichas de Drive</h1>
    <p className="mt-3 text-sm leading-6 text-[#60757a]">Carga el archivo preparado desde tus documentos de Drive. Podrás revisar las fichas antes de guardarlas en Gestión Dental.</p>
    <section className="mt-5 rounded-xl border border-[#c8d6d9] bg-white p-4 sm:p-5">
      <label className="block text-sm font-semibold" htmlFor="import-file">Archivo de fichas</label>
      <input id="import-file" type="file" accept="application/json,.json" disabled={busy} onChange={e => { void loadFile(e.target.files?.[0]); e.target.value = ""; }} className="mt-3 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-[#edf7f7] file:px-4 file:py-2 file:text-[#087f83]" />
      {fileName && <p className="mt-2 text-sm text-[#60757a]">Archivo seleccionado: {fileName}</p>}
      <p className="mt-3 text-xs leading-5 text-[#60757a]">Se conservan los documentos originales. Las fichas se identifican por su carpeta y las evoluciones por documento y fecha. Las fechas no consignadas permanecen sin fecha; las notas conservan su texto original.</p>
      <button type="button" disabled={busy || !payload.trim()} onClick={() => void submit(false)} className="mt-4 rounded-xl bg-[#087f83] px-6 py-3 font-medium text-white disabled:opacity-50">{busy ? "Procesando…" : "Revisar archivo"}</button>
    </section>
    {preview && <section className="mt-5 rounded-xl border border-[#c8d6d9] bg-white p-4" aria-label="Vista previa de importación">
      <h2 className="font-semibold">Vista previa</h2>
      <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Paciente</th><th className="p-2">Ficha</th><th className="p-2">Evoluciones nuevas</th><th className="p-2">Ya presentes</th></tr></thead><tbody>{preview.map((item, index) => <tr key={index} className="border-t border-[#edf1f2]"><td className="p-2">{item.name}</td><td className="p-2">{item.sameNameMatches ? "Coincidencia por aclarar" : item.patientAlreadyLinked ? "Existente" : "Nueva"}</td><td className="p-2">{item.notesToCreate}</td><td className="p-2">{item.notesAlreadyPresent}</td></tr>)}</tbody></table></div>
      {ambiguous && <p role="alert" className="mt-3 text-sm text-amber-800">Hay nombres que coinciden con fichas sin vincular. Se debe identificar la ficha correcta antes de importar este lote.</p>}
      <button type="button" disabled={busy || ambiguous} onClick={() => void submit(true)} className="mt-4 rounded-xl bg-[#087f83] px-6 py-3 font-medium text-white disabled:opacity-50">{busy ? "Procesando…" : "Confirmar importación"}</button>
    </section>}
    {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {message && <p role="status" className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{message} <Link href="/" className="underline">Abrir pacientes</Link></p>}
    <details className="mt-5 rounded-xl border border-[#dce5e7] p-4"><summary className="cursor-pointer text-sm font-semibold">Pegar un lote revisado</summary>
      <label className="mt-4 block text-sm font-medium" htmlFor="records">Registros clínicos</label>
      <textarea id="records" disabled={busy} className="mt-2 min-h-56 w-full rounded-xl border border-[#c8d6d9] p-4 font-mono text-sm" value={payload} onChange={e => { changePayload(e.target.value); setFileName(""); }} spellCheck={false} />
    </details>
    <details className="mt-5 rounded-xl border border-[#dce5e7] p-4"><summary className="cursor-pointer text-sm font-semibold">Importar con ChatGPT</summary><p className="mt-2 text-sm leading-6 text-[#60757a]">Conecta Google Drive y Gestión Dental en la conversación. Si el conector ya está instalado pero ChatGPT no puede usar sus herramientas, abre una conversación nueva con ambos conectores y pide importar las fichas. La sesión del sitio y las herramientas de cada conversación se gestionan por separado.</p></details>
    <p className="mt-5 text-xs leading-5 text-[#60757a]">Este importador incorpora datos básicos y evoluciones. Los odontogramas, periodontogramas, citas, presupuestos e imágenes requieren su propio registro estructurado.</p>
  </main>;
}
