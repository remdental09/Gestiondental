"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BadgeCheck, FileCheck2, FilePlus2, FileText, ImagePlus, LoaderCircle, Pencil, Printer, ScrollText, ShieldCheck, Trash2 } from "lucide-react";
import Image from "next/image";
import qrcode from "qrcode-generator";
import { ageFromBirthDate, splitPrescriptionLines, CLINICAL_DOCUMENT_KINDS, CLINICAL_DOCUMENT_LABEL, type ClinicalDocumentContent, type ClinicalDocumentKind } from "@/lib/clinical-documents";
import { shortCode, verificationUrl } from "@/lib/document-verification";
import { formatAddress, type PatientAddress } from "@/lib/patient-address";
import { RNPI_SITE, VALIDATION_SITE, registrationLine, type PublicRegistration } from "@/lib/prestador-certificate";
import { PrestadorCard, type MyRegistration } from "@/components/prestador-card";

type Patient = { id: number; name: string; birthDate: string; rut: string; phone: string; email: string; address?: PatientAddress };
type SavedDocument = { id: number; patientId: number; kind: ClinicalDocumentKind; title: string; content: string; status: string; createdBy: string; createdByName: string; createdAt: string; documentMark: string; verifyToken?: string | null; contentHash?: string; issuedAt?: string; revokedAt?: string; revokedReason?: string; replacesId?: number | null; registration?: PublicRegistration | null };
type ClinicInfo = { clinicName: string; address: string; city: string; phone: string; email: string; logo: string };
type Field = { key: string; label: string; hint: string; rows?: number };
const fields: Record<ClinicalDocumentKind, Field[]> = {
  receta: [
    { key: "indicacion", label: "Indicación o motivo", hint: "Completar según evaluación profesional" },
    { key: "prescripcion", label: "Prescripción", hint: "Medicamento, presentación y pauta indicada", rows: 4 },
    { key: "instrucciones", label: "Instrucciones al paciente", hint: "Indicaciones complementarias", rows: 3 },
  ],
  certificado: [
    { key: "motivo", label: "Motivo del certificado", hint: "Escribe el motivo que corresponde certificar" },
    { key: "observaciones", label: "Observaciones", hint: "Antecedentes que el profesional deja consignados", rows: 4 },
    { key: "vigencia", label: "Fecha o vigencia", hint: "Solo si corresponde" },
  ],
  consentimiento: [
    { key: "procedimiento", label: "Procedimiento propuesto", hint: "Nombre del tratamiento que se explicará" },
    { key: "descripcion", label: "Descripción y alcance", hint: "Qué se realizará y qué queda fuera", rows: 4 },
    { key: "riesgos", label: "Riesgos y posibles complicaciones", hint: "Completar individualmente y explicar al paciente", rows: 4 },
    { key: "alternativas", label: "Alternativas y consecuencias de no tratar", hint: "Completar según el caso", rows: 3 },
    { key: "declaracion", label: "Declaraciones o acuerdos específicos", hint: "Preguntas, dudas o acuerdos que se quieran dejar escritos", rows: 3 },
  ],
};
const blankContent = (): ClinicalDocumentContent => ({ indicacion: "", prescripcion: "", instrucciones: "", motivo: "", observaciones: "", vigencia: "", procedimiento: "", descripcion: "", riesgos: "", alternativas: "", declaracion: "" });
const cardClass = "rounded-xl border border-[#e6e4ee] bg-white p-4";
const inputClass = "mt-1 min-h-11 w-full rounded-lg border border-[#d2d4df] bg-white px-3 py-2 text-sm text-[#35343f] outline-none focus:border-[#75669d] focus:ring-2 focus:ring-[#473a6d]/15";
const formatDate = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "Fecha sin registrar" : new Intl.DateTimeFormat("es-CL", { dateStyle: "long", timeZone: "America/Santiago" }).format(date);
};

const STATUS_LABEL: Record<string, string> = { borrador: "Borrador", emitido: "Emitido", anulado: "Anulado", reemplazado: "Reemplazado" };
const isIssued = (doc: { status: string }) => doc.status !== "borrador";
const qrSvg = (url: string) => { const qr = qrcode(0, "M"); qr.addData(url); qr.make(); return qr.createSvgTag({ cellSize: 3, margin: 0, scalable: true }); };

export function DocumentationPanel({ patients, budgetCounts, onOpenBudgets }: {
  patients: Patient[];
  budgetCounts: Record<number, number>;
  onOpenBudgets: (patientId: number) => void;
}) {
  const [requestedPatientId, setPatientId] = useState(0);
  const patientId = patients.some(item => item.id === requestedPatientId) ? requestedPatientId : patients[0]?.id ?? 0;
  const patient = patients.find(item => item.id === patientId) ?? null;
  const [kind, setKind] = useState<ClinicalDocumentKind>("receta");
  const [content, setContent] = useState<ClinicalDocumentContent>(blankContent);
  const [documentsState, setDocumentsState] = useState<{ patientId: number; documents: SavedDocument[]; error: string }>({ patientId: 0, documents: [], error: "" });
  const [activeDocumentId, setActiveDocumentId] = useState<number | null>(null);
  const [clinic, setClinic] = useState<ClinicInfo | null>(null);
  const [documentMark, setDocumentMark] = useState("");
  const [saving, setSaving] = useState(false);
  const [replacingId, setReplacingId] = useState<number | null>(null);
  const [registration, setRegistration] = useState<MyRegistration>(null);
  const [registrationLoading, setRegistrationLoading] = useState(true);
  const [registrationUploading, setRegistrationUploading] = useState(false);
  const [registrationError, setRegistrationError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const documents = documentsState.patientId === patientId ? documentsState.documents : [];
  const activeDocument = documents.find(item => item.id === activeDocumentId) ?? null;
  const documentLoading = Boolean(patientId) && documentsState.patientId !== patientId;
  const documentLoadError = documentsState.patientId === patientId ? documentsState.error : "";

  useEffect(() => {
    let active = true;
    void fetch("/api/clinica", { cache: "no-store" }).then(async response => {
      const data = await response.json() as { clinic?: ClinicInfo; error?: string };
      if (!response.ok || !data.clinic) throw new Error(data.error || "No se cargó el perfil de la clínica.");
      if (active) setClinic(data.clinic);
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "No se cargó el perfil de la clínica."); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    void fetch("/api/documentos/imagen", { cache: "no-store" }).then(async response => {
      const data = await response.json() as { documentMark?: string; error?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo leer tu imagen de firma o timbre.");
      if (active) setDocumentMark(data.documentMark ?? "");
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "No se pudo leer tu imagen de firma o timbre."); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!patientId) return;
    const controller = new AbortController();
    void fetch(`/api/documentos?patientId=${patientId}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      const data = await response.json() as { documents?: SavedDocument[]; error?: string };
      if (!response.ok || !data.documents) throw new Error(data.error || "No se pudieron cargar los documentos.");
      setDocumentsState({ patientId, documents: data.documents, error: "" });
    }).catch(reason => { if (!controller.signal.aborted) setDocumentsState({ patientId, documents: [], error: reason instanceof Error ? reason.message : "No se pudieron cargar los documentos." }); });
    return () => controller.abort();
  }, [patientId]);


  const patchDocument = (updated: SavedDocument, previousId?: number | null) => setDocumentsState(previous => ({ ...previous, documents: previous.documents.map(item => item.id === updated.id ? { ...item, ...updated, documentMark: item.documentMark } : item.id === previousId ? { ...item, status: "reemplazado", revokedReason: "reemplazado", revokedAt: updated.issuedAt ?? "" } : item) }));
  const act = async (path: string, doc: SavedDocument, done: string) => {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: doc.id }) });
      const data = await response.json() as { document?: SavedDocument; replacedId?: number | null; error?: string };
      if (!response.ok || !data.document) throw new Error(data.error || "No se pudo completar la acción.");
      patchDocument(data.document, data.replacedId); setNotice(done);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo completar la acción."); }
    finally { setBusy(false); }
  };
  const issue = (doc: SavedDocument) => { if (window.confirm("¿Desea emitir este documento? Quedará bloqueado y con un QR de verificación. Para cambiarlo deberá crear una versión nueva.")) void act("/api/documentos/emitir", doc, "Documento emitido con QR de verificación. Ya puedes imprimirlo."); };
  const annul = (doc: SavedDocument) => { if (window.confirm("¿Desea anular este documento? Nunca se borra, pero la verificación por QR lo mostrará como anulado y no podrá deshacerse.")) void act("/api/documentos/anular", doc, "Documento anulado. La verificación por QR lo muestra como anulado."); };
  useEffect(() => {
    let active = true;
    void fetch("/api/prestador", { cache: "no-store" }).then(async response => {
      const data = await response.json() as { registration?: MyRegistration; error?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo leer tu habilitación.");
      if (active) setRegistration(data.registration ?? null);
    }).catch(reason => { if (active) setRegistrationError(reason instanceof Error ? reason.message : "No se pudo leer tu habilitación."); })
      .finally(() => { if (active) setRegistrationLoading(false); });
    return () => { active = false; };
  }, []);
  const sendCertificateText = async (texto: string) => {
    setRegistrationUploading(true); setRegistrationError("");
    try {
      const response = await fetch("/api/prestador", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texto }) });
      const data = await response.json() as { registration?: MyRegistration; error?: string };
      if (!response.ok || !data.registration) throw new Error(data.error || "No se pudo leer el certificado.");
      setRegistration(data.registration);
    } catch (reason) { setRegistrationError(reason instanceof Error ? reason.message : "No se pudo leer el certificado."); }
    finally { setRegistrationUploading(false); }
  };
  const uploadCertificate = async (file: File) => {
    setRegistrationUploading(true); setRegistrationError("");
    try {
      const body = new FormData(); body.set("certificado", file);
      const response = await fetch("/api/prestador", { method: "POST", body });
      const data = await response.json() as { registration?: MyRegistration; error?: string };
      if (!response.ok || !data.registration) throw new Error(data.error || "No se pudo leer el certificado.");
      setRegistration(data.registration);
    } catch (reason) { setRegistrationError(reason instanceof Error ? reason.message : "No se pudo leer el certificado."); }
    finally { setRegistrationUploading(false); }
  };
  const canIssueReceta = registration?.status === "aprobado";

  const hasContent = fields[kind].some(field => content[field.key]?.trim());
  const saveDraft = async () => {
    if (!patient || !hasContent || saving) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/documentos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patientId: patient.id, kind, content, replacesId: replacingId }) });
      const data = await response.json() as { document?: SavedDocument; error?: string };
      if (!response.ok || !data.document) throw new Error(data.error || "No se pudo guardar el borrador.");
      setDocumentsState(previous => ({ patientId: patient.id, documents: [data.document!, ...(previous.patientId === patient.id ? previous.documents : [])], error: "" }));
      setActiveDocumentId(data.document.id);
      setContent(blankContent()); setReplacingId(null);
      setNotice("Borrador guardado. Revísalo y pulsa «Emitir» para generar el QR de verificación e imprimir.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo guardar el borrador."); }
    finally { setSaving(false); }
  };

  const activeContent = useMemo(() => {
    if (!activeDocument) return null;
    try { return JSON.parse(activeDocument.content) as ClinicalDocumentContent; } catch { return {}; }
  }, [activeDocument]);
  const prescriptionLines = useMemo(() => splitPrescriptionLines(activeContent?.prescripcion ?? ""), [activeContent]);
  const patientAge = patient ? ageFromBirthDate(patient.birthDate) : null;

  return <div className="space-y-6" data-testid="documentation-panel">
    <section className="surface">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-lg font-semibold text-[#35343f]">Documentos del paciente</h2><p className="mt-1 max-w-3xl text-sm text-[#615f73]">Prepara recetas, certificados y consentimientos editables. Se guardan como borradores en la ficha elegida; puedes revisarlos e imprimirlos.</p></div>
        {patient && <button type="button" onClick={() => onOpenBudgets(patient.id)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#b9b1ce] px-3 text-sm font-semibold text-[#473a6d] hover:bg-[#f3f1f7]"><FileText className="size-4"/>Presupuestos ({budgetCounts[patient.id] ?? 0})</button>}
      </div>
      <label className="mt-5 block max-w-xl text-sm font-semibold text-[#35343f]">Paciente
        <select value={patientId || ""} onChange={event => { setPatientId(Number(event.target.value)); setActiveDocumentId(null); setContent(blankContent()); setNotice(""); }} className={inputClass} aria-label="Elegir paciente">
          {!patients.length && <option value="">No hay pacientes registrados</option>}
          {patients.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      {!patients.length && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">Registra o importa un paciente para crear documentos en su ficha.</p>}
    </section>

    {patient && <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,.82fr)]">
      <section className="surface min-w-0">
        <div className="flex items-start gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#eae8f0] text-[#473a6d]"><FilePlus2 className="size-5"/></span><div><h2 className="text-lg font-semibold">Crear documento</h2><p className="text-sm text-[#615f73]">Completa solo los datos que correspondan y guarda para abrir la vista de impresión.</p></div></div>
        <div className="mt-5 grid gap-2 sm:grid-cols-3" role="tablist" aria-label="Tipo de documento">
          {CLINICAL_DOCUMENT_KINDS.map(value => <button key={value} type="button" role="tab" aria-selected={kind === value} onClick={() => { setKind(value); setNotice(""); }} className={`min-h-11 rounded-lg border px-3 text-sm font-semibold ${kind === value ? "border-[#6a5b91] bg-[#eeebf3] text-[#3f345e]" : "border-[#e6e4ee] bg-white text-[#615f73] hover:bg-[#f7f6fa]"}`}>{CLINICAL_DOCUMENT_LABEL[value]}</button>)}
        </div>
        <div className="mt-4 space-y-3">
          {fields[kind].map(field => <label key={field.key} className="block text-sm font-semibold text-[#35343f]">{field.label}
            {field.rows ? <textarea rows={field.rows} value={content[field.key] ?? ""} onChange={event => setContent(previous => ({ ...previous, [field.key]: event.target.value }))} placeholder={field.hint} className={inputClass + " resize-y"}/> : <input value={content[field.key] ?? ""} onChange={event => setContent(previous => ({ ...previous, [field.key]: event.target.value }))} placeholder={field.hint} className={inputClass}/>}
          </label>)}
        </div>
        {kind === "consentimiento" && <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">Borrador editable. Revisa riesgos y alternativas con el paciente, adapta el contenido al procedimiento y obtén la firma correspondiente. La aplicación no valida legalmente el texto ni firma por el paciente.</p>}
        {error && <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
        {notice && !error && <p role="status" className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
        <button type="button" onClick={() => void saveDraft()} disabled={!hasContent || saving} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#473a6d] px-4 text-sm font-semibold text-white hover:bg-[#3a2f5a] disabled:cursor-not-allowed disabled:opacity-50">
          {saving ? <LoaderCircle className="size-4 animate-spin"/> : <FileCheck2 className="size-4"/>}{saving ? "Guardando…" : "Guardar borrador"}
        </button>
      </section>

      <div className="min-w-0 space-y-6">
        <section className={cardClass}>
          <div className="flex items-center gap-2"><ScrollText className="size-5 text-[#473a6d]"/><h2 className="font-semibold">Documentos guardados</h2></div>
          {documentLoading ? <p className="mt-3 text-sm text-[#615f73]" role="status">Cargando documentos…</p> : documentLoadError ? <p role="alert" className="mt-3 text-sm text-rose-800">{documentLoadError}</p> : documents.length ? <ul className="mt-3 space-y-2">{documents.map(document => <li key={document.id}><button type="button" onClick={() => { setActiveDocumentId(document.id); setNotice(""); }} aria-pressed={activeDocument?.id === document.id} className={`w-full rounded-lg border p-3 text-left ${activeDocument?.id === document.id ? "border-[#9b8cba] bg-[#f4f2f7]" : "border-[#e6e4ee] bg-white hover:bg-[#f8f7fa]"}`}><span className="flex items-center justify-between gap-2"><strong className="text-sm">{document.title}</strong><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${document.status === "emitido" ? "bg-emerald-100 text-emerald-900" : document.status === "anulado" ? "bg-rose-100 text-rose-900" : document.status === "reemplazado" ? "bg-orange-100 text-orange-900" : "bg-[#eeebf3] text-[#473a6d]"}`}>{STATUS_LABEL[document.status] ?? document.status}</span></span><span className="mt-1 block text-xs text-[#615f73]">{formatDate(document.createdAt)}{document.createdByName ? ` · ${document.createdByName}` : ""}</span></button></li>)}</ul> : <p className="mt-3 rounded-lg bg-[#f7f6fa] p-3 text-sm text-[#615f73]">Todavía no hay documentos en esta ficha.</p>}
        </section>

        <PrestadorCard registration={registration} loading={registrationLoading} uploading={registrationUploading} error={registrationError} onUpload={file => void uploadCertificate(file)} onPasteText={text => void sendCertificateText(text)}/>

        <DocumentMarkEditor mark={documentMark} onSaved={setDocumentMark}/>
      </div>
    </div>}

    {patient && activeDocument && activeContent && <section className="surface" aria-label="Vista previa del documento">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden"><div><p className="text-xs font-semibold uppercase tracking-wide text-[#6b5d8e]">Vista previa · {(STATUS_LABEL[activeDocument.status] ?? activeDocument.status).toLowerCase()}</p><h2 className="mt-1 text-lg font-semibold">{activeDocument.title}</h2></div><div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => { setKind(activeDocument.kind); setContent({ ...blankContent(), ...activeContent }); setReplacingId(activeDocument.status === "emitido" ? activeDocument.id : null); setNotice(activeDocument.status === "emitido" ? "Se cargó el texto para crear una versión nueva. Al emitirla, la versión anterior quedará como reemplazada." : "Se cargó el texto para crear una nueva versión; el borrador anterior se conserva."); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[#b9b1ce] px-4 text-sm font-semibold text-[#473a6d] hover:bg-[#f3f1f7]"><Pencil className="size-4"/>{isIssued(activeDocument) ? "Crear versión nueva" : "Editar una copia"}</button>
        {activeDocument.status === "borrador" && <button type="button" disabled={busy || (activeDocument.kind === "receta" && !canIssueReceta)} title={activeDocument.kind === "receta" && !canIssueReceta ? "Sube y espera la aprobación de tu certificado de inscripción para emitir recetas" : undefined} onClick={() => issue(activeDocument)} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#473a6d] px-4 text-sm font-semibold text-white hover:bg-[#3a2f5a] disabled:opacity-50">{busy ? <LoaderCircle className="size-4 animate-spin"/> : <ShieldCheck className="size-4"/>}Emitir con QR</button>}
        {activeDocument.status === "emitido" && <><button type="button" onClick={() => window.print()} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#473a6d] px-4 text-sm font-semibold text-white hover:bg-[#3a2f5a]"><Printer className="size-4"/>Imprimir o guardar como PDF</button><button type="button" disabled={busy} onClick={() => annul(activeDocument)} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-rose-300 px-4 text-sm font-semibold text-rose-800 hover:bg-rose-50 disabled:opacity-50"><Trash2 className="size-4"/>Anular</button></>}
      </div></div>
      {(error || notice) && <p role={error ? "alert" : "status"} className={`mb-4 rounded-lg p-3 text-sm print:hidden ${error ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-900"}`}>{error || notice}</p>}
      {activeDocument.status === "borrador" && <p className="mb-4 rounded-lg bg-[#f3f1f7] p-3 text-sm text-[#473a6d] print:hidden">Este documento es un borrador. Pulsa «Emitir con QR» para bloquearlo y habilitar la impresión con su código de verificación.{activeDocument.kind === "receta" && !canIssueReceta && " Para emitir recetas primero debes subir tu certificado de inscripción (tarjeta «Habilitación para emitir recetas») y esperar su aprobación."}</p>}
      <article id="documentation-print" className="mx-auto max-w-[800px] overflow-hidden rounded-xl border border-[#e6e4ee] bg-white text-[#272533] shadow-sm print:rounded-none print:border-0 print:shadow-none [print-color-adjust:exact] [-webkit-print-color-adjust:exact]">
        <header className="bg-gradient-to-r from-[#473a6d] to-[#6b5d8e] px-7 py-6 text-white">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/75">{clinic?.clinicName || "Clínica"}</p>
              <h2 className="mt-2 text-3xl font-bold tracking-tight">{activeDocument.title}</h2>
              {(clinic?.address || clinic?.city || clinic?.phone || clinic?.email) && <p className="mt-2 text-xs leading-relaxed text-white/80">{[clinic.address, clinic.city].filter(Boolean).join(", ")}{(clinic.address || clinic.city) && (clinic.phone || clinic.email) ? " · " : ""}{[clinic.phone, clinic.email].filter(Boolean).join(" · ")}</p>}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2 text-right">
              {clinic?.logo && <span className="rounded-lg bg-white p-1.5"><Image src={clinic.logo} alt="Logo de la clínica" width={200} height={200} unoptimized className="max-h-14 max-w-24 object-contain"/></span>}
              <p className="text-[11px] uppercase tracking-wider text-white/75">N° {String(activeDocument.id).padStart(5, "0")}</p>
            </div>
          </div>
        </header>
        {activeDocument.status === "anulado" && <p className="bg-rose-100 px-7 py-2 text-center text-sm font-bold uppercase tracking-widest text-rose-900">Documento anulado</p>}
        {activeDocument.status === "reemplazado" && <p className="bg-orange-100 px-7 py-2 text-center text-sm font-bold uppercase tracking-widest text-orange-900">Documento reemplazado por una versión nueva</p>}
        {activeDocument.status === "borrador" && <p className="bg-[#f3f1f7] px-7 py-2 text-center text-xs font-semibold uppercase tracking-widest text-[#615f73]">Borrador · sin verificación</p>}
        <div className="px-7 pb-8 pt-6">
          <section className="grid gap-x-8 gap-y-2 rounded-lg border border-[#e6e4ee] bg-[#faf9fc] p-4 text-sm sm:grid-cols-2">
            <p><span className="block text-[11px] font-semibold uppercase tracking-wider text-[#6b5d8e]">Paciente</span><span className="font-semibold">{patient.name}</span></p>
            <p><span className="block text-[11px] font-semibold uppercase tracking-wider text-[#6b5d8e]">Identificación</span>{patient.rut || "Sin registrar"}</p>
            <p><span className="block text-[11px] font-semibold uppercase tracking-wider text-[#6b5d8e]">Edad</span>{patientAge === null ? "Sin registrar" : `${patientAge} años`}</p>
            <p><span className="block text-[11px] font-semibold uppercase tracking-wider text-[#6b5d8e]">Fecha de emisión</span>{formatDate(activeDocument.createdAt)}</p>
            <p className="sm:col-span-2"><span className="block text-[11px] font-semibold uppercase tracking-wider text-[#6b5d8e]">Profesional</span>{activeDocument.createdByName || "Sin registrar"}{activeDocument.registration && <span className="block text-xs text-[#44425a]">{[activeDocument.registration.profession, ...activeDocument.registration.specialties].join(" · ")} · RUN {activeDocument.registration.run} · {registrationLine(activeDocument.registration)}</span>}{[clinic?.address, clinic?.city].filter(Boolean).length > 0 && <span className="block text-xs text-[#44425a]">Domicilio: {[clinic?.address, clinic?.city].filter(Boolean).join(", ")}</span>}</p>
            {formatAddress(patient.address) && <p className="sm:col-span-2"><span className="block text-[11px] font-semibold uppercase tracking-wider text-[#6b5d8e]">Domicilio del paciente</span>{formatAddress(patient.address)}</p>}
          </section>
          {activeDocument.kind === "receta" ? <div className="mt-6 space-y-6">
            {activeContent.indicacion?.trim() && <section><h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#6b5d8e]">Indicación o motivo</h3><p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{activeContent.indicacion.trim()}</p></section>}
            <section>
              <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[#6b5d8e]"><span className="font-serif text-2xl normal-case italic leading-none text-[#473a6d]">Rp.</span>Prescripción</h3>
              {prescriptionLines.length ? <ol className="mt-3 space-y-2">{prescriptionLines.map((line, index) => <li key={index} className="flex gap-3 rounded-lg border border-[#e6e4ee] px-4 py-3"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#eeebf3] text-xs font-bold text-[#473a6d]">{index + 1}</span><div><p className="font-semibold">{line.name}</p>{line.detail && <p className="mt-0.5 text-sm leading-relaxed text-[#44425a]">{line.detail}</p>}</div></li>)}</ol> : <p className="mt-2 text-sm text-[#615f73]">—</p>}
            </section>
            {activeContent.instrucciones?.trim() && <section className="rounded-lg bg-[#f3f1f7] p-4"><h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#6b5d8e]">Instrucciones al paciente</h3><p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{activeContent.instrucciones.trim()}</p></section>}
          </div> : <div className="mt-6 space-y-4">{fields[activeDocument.kind].map(field => <section key={field.key}><h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#6b5d8e]">{field.label}</h3><p className="mt-1 min-h-5 whitespace-pre-wrap text-sm leading-relaxed">{activeContent[field.key]?.trim() || "—"}</p></section>)}</div>}
          {activeDocument.kind === "consentimiento" && <p className="mt-6 rounded-lg border border-[#dddbe6] p-3 text-sm leading-relaxed">Borrador para revisión clínica. Este texto no sustituye la conversación con el paciente ni la verificación del contenido aplicable al procedimiento y sus circunstancias.</p>}
          <footer className={`mt-14 grid gap-10 text-center text-xs ${activeDocument.kind === "receta" ? "grid-cols-1 justify-items-end" : "grid-cols-2"}`}>
            <div className={`flex min-h-28 flex-col items-center justify-end ${activeDocument.kind === "receta" ? "w-full max-w-[320px]" : ""}`}>{activeDocument.documentMark && <Image src={activeDocument.documentMark} alt="Imagen de firma o timbre" width={200} height={200} unoptimized className="mb-2 max-h-16 max-w-44 object-contain"/>}<div className="w-full border-t border-[#777] pt-2"><span className="font-semibold">{activeDocument.createdByName}</span><br/>Firma / timbre profesional</div></div>
            {activeDocument.kind !== "receta" && <div className="flex min-h-28 flex-col justify-end"><div className="w-full border-t border-[#777] pt-2"><span className="font-semibold">{patient.name}</span><br/>Firma del paciente</div></div>}
          </footer>
          {activeDocument.registration && <p className="mt-8 text-[11px] leading-relaxed text-[#6b6a7c]">Habilitación del profesional: inscrito en el Registro Nacional de Prestadores Individuales de Salud. {activeDocument.registration.validationCode ? <>Verifíquelo en {VALIDATION_SITE} con el código de validación <span className="font-mono font-semibold">{activeDocument.registration.validationCode}</span> (certificado del {activeDocument.registration.issuedOn.split("-").reverse().join("/")}).</> : <>Consulte al profesional en {RNPI_SITE}.</>} Esto acredita al profesional; no valida esta receta.</p>}
          {activeDocument.verifyToken && activeDocument.contentHash && <aside className="mt-10 flex items-center gap-4 rounded-lg border border-[#e6e4ee] bg-[#faf9fc] p-3 text-left [break-inside:avoid]">
            <div className="size-24 shrink-0 bg-white p-1 [&_svg]:size-full" role="img" aria-label="Código QR de verificación del documento" dangerouslySetInnerHTML={{ __html: qrSvg(verificationUrl(window.location.origin, activeDocument.verifyToken)) }}/>
            <div className="min-w-0 text-[11px] leading-relaxed text-[#44425a]"><p className="text-xs font-bold uppercase tracking-wider text-[#473a6d]">Verificación de documento</p><p className="mt-1">Escanee el código para confirmar que fue emitido desde Gestión Dental y que está vigente.</p><p className="mt-1">Código: <span className="font-mono font-semibold">{shortCode(activeDocument.contentHash)}</span> · Emitido {formatDate(activeDocument.issuedAt || activeDocument.createdAt)}</p><p className="mt-1 text-[#6b6a7c]">No es firma electrónica avanzada.</p></div>
          </aside>}
        </div>
      </article>
    </section>}
  </div>;
}

function DocumentMarkEditor({ mark, onSaved }: { mark: string; onSaved: (mark: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const drawing = useRef(false);
  const [hasImage, setHasImage] = useState(Boolean(mark));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !mark) return;
    const image = new window.Image();
    image.onload = () => { const ctx = canvas.getContext("2d"); if (!ctx) return; ctx.clearRect(0, 0, canvas.width, canvas.height); const scale = Math.min((canvas.width - 24) / image.width, (canvas.height - 24) / image.height); const width = image.width * scale, height = image.height * scale; ctx.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height); setHasImage(true); setDirty(false); };
    image.src = mark;
  }, [mark]);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * event.currentTarget.width / rect.width, y: (event.clientY - rect.top) * event.currentTarget.height / rect.height };
  };
  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget, ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.setPointerCapture(event.pointerId); drawing.current = true;
    const at = point(event); ctx.beginPath(); ctx.moveTo(at.x, at.y); ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#252239"; ctx.lineWidth = 5; ctx.lineTo(at.x + .01, at.y + .01); ctx.stroke();
    setHasImage(true); setDirty(true); setError(""); setNotice("");
  };
  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = event.currentTarget.getContext("2d"); if (!ctx) return;
    const at = point(event); ctx.lineTo(at.x, at.y); ctx.stroke();
  };
  const stop = () => { drawing.current = false; };
  const pickFile = async (file?: File) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 5 * 1024 * 1024) { setError("Elige una imagen PNG, JPG o WebP de hasta 5 MB."); return; }
    try {
      const image = await createImageBitmap(file), canvas = canvasRef.current, ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) throw new Error("No se pudo abrir el cuadro de dibujo.");
      ctx.clearRect(0, 0, canvas.width, canvas.height); const scale = Math.min((canvas.width - 24) / image.width, (canvas.height - 24) / image.height); const width = image.width * scale, height = image.height * scale;
      ctx.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height); image.close(); setHasImage(true); setDirty(true); setError(""); setNotice("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo leer la imagen."); }
  };
  const clear = () => { const canvas = canvasRef.current; canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height); setHasImage(false); setDirty(true); setError(""); setNotice(""); };
  const save = async () => {
    const canvas = canvasRef.current;
    if (!canvas || saving) return;
    setSaving(true); setError(""); setNotice("");
    try {
      let documentMark = "";
      if (hasImage) {
        const small = document.createElement("canvas"); small.width = 200; small.height = 200;
        const ctx = small.getContext("2d"); if (!ctx) throw new Error("No se pudo preparar la imagen.");
        const scale = Math.min(188 / canvas.width, 188 / canvas.height); const width = canvas.width * scale, height = canvas.height * scale;
        ctx.drawImage(canvas, (200 - width) / 2, (200 - height) / 2, width, height); documentMark = small.toDataURL("image/png");
        if (documentMark.length > 80_000) throw new Error("La imagen tiene demasiados detalles. Dibuja una firma más simple o sube una imagen más pequeña.");
      }
      const response = await fetch("/api/documentos/imagen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentMark }) });
      const result = await response.json() as { documentMark?: string; error?: string };
      if (!response.ok || typeof result.documentMark !== "string") throw new Error(result.error || "No se pudo guardar la imagen.");
      onSaved(result.documentMark); setDirty(false); setNotice(result.documentMark ? "Tu imagen queda disponible en tus documentos y presupuestos." : "Imagen quitada de tus documentos nuevos.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo guardar la imagen."); }
    finally { setSaving(false); }
  };

  return <section className={cardClass}>
    <div className="flex items-start gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#eeebf3] text-[#473a6d]"><Pencil className="size-4"/></span><div><h2 className="font-semibold">Mi firma o timbre</h2><p className="mt-1 text-sm text-[#615f73]">Dibújalo aquí o sube una imagen; tus documentos y presupuestos la usarán junto a tu nombre.</p></div></div>
    <canvas ref={canvasRef} width={600} height={180} aria-label="Cuadro para dibujar la firma o el timbre" onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} className="mt-4 h-32 w-full touch-none cursor-crosshair rounded-lg border border-dashed border-[#bcb5cc] bg-white"/>
    <><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => fileRef.current?.click()} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#473a6d] px-3 text-sm font-semibold text-[#473a6d] hover:bg-[#f3f1f7]"><ImagePlus className="size-4"/>Subir imagen</button><button type="button" onClick={clear} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#dddbe6] px-3 text-sm font-semibold text-[#615f73] hover:bg-[#f7f6fa]"><Trash2 className="size-4"/>Limpiar</button><button type="button" disabled={!dirty || saving} onClick={() => void save()} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#473a6d] px-3 text-sm font-semibold text-white hover:bg-[#3a2f5a] disabled:opacity-50">{saving ? <LoaderCircle className="size-4 animate-spin"/> : <BadgeCheck className="size-4"/>}{saving ? "Guardando…" : "Guardar imagen"}</button></div><input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={event => { void pickFile(event.target.files?.[0]); event.target.value = ""; }}/><p className="mt-2 text-xs text-[#615f73]">Se guarda como imagen para documentos; no firma electrónicamente ni reemplaza una firma manuscrita cuando corresponda. Cada profesional configura la suya.</p></>
    {error && <p role="alert" className="mt-3 text-sm text-rose-800">{error}</p>}{notice && !error && <p role="status" className="mt-3 text-sm text-emerald-900">{notice}</p>}
  </section>;
}
