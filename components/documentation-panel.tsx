"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, PenLine, Mail, FileDown, Search, ArrowLeft, ChevronRight, ClipboardCheck, ClipboardList, FlaskConical, Pill, FileCheck2, FilePlus2, FileText, LoaderCircle, Pencil, Printer, ScrollText, ShieldCheck, Trash2 } from "lucide-react";
import Image from "next/image";
import qrcode from "qrcode-generator";
import { ageFromBirthDate, parseMedications, MEDICATION_MAX, VIAS, VIAS_FRECUENTES, DOSE_UNITS, DOSE_UNIT_KEYS, TIME_UNITS, TIME_UNIT_KEYS, autoQuantityText, medicationDosis, medicationLine, type Medication, splitPrescriptionLines, isPrescriptionKind, requiresHabilitacionQr, habilitacionNoun, CLINICAL_DOCUMENT_KINDS, CLINICAL_DOCUMENT_LABEL, type ClinicalDocumentContent, type ClinicalDocumentKind } from "@/lib/clinical-documents";
import { shortCode, verificationUrl } from "@/lib/document-verification";
import { ConsentSigningCard, PatientSignatureImage } from "@/components/consent-signing";
import { ConsentTemplatePicker } from "@/components/consent-template-picker";
import { SIGNER_ROLE_LABEL, SIGN_METHOD_LABEL, isSignMethod, isSignerRole, signatureListMark, type SignatureView } from "@/lib/consent-signature";
import { formatAddress, type PatientAddress } from "@/lib/patient-address";
import { registrationLine, type PublicRegistration } from "@/lib/prestador-certificate";
import { formatChileanRut, isValidChileanRut } from "@/lib/patient-document";
import { asProfessionalTitle, withTitle } from "@/lib/clinician-profile";
import { qrCaption } from "@/lib/prestador-qr";
import { PrestadorCard, usePrestador } from "@/components/prestador-card";
import { useTrimmedMark } from "@/components/signature-editor";
import { mountPrintCopy, printNode, PRINT_CLASS } from "@/lib/print-node";
import { scrollBelowHeader } from "@/lib/scroll-below-header";

type Patient = { id: number; name: string; birthDate: string; rut: string; phone: string; email: string; address?: PatientAddress };
type SavedDocument = { id: number; patientId: number; kind: ClinicalDocumentKind; title: string; content: string; status: string; createdBy: string; createdByName: string; authorTitle?: string | null; createdAt: string; documentMark: string; verifyToken?: string | null; contentHash?: string; issuedAt?: string; revokedAt?: string; revokedReason?: string; replacesId?: number | null; registration?: PublicRegistration | null; signature?: SignatureView | null };
type ClinicInfo = { clinicName: string; address: string; city: string; phone: string; email: string; logo: string };
type Field = { key: string; label: string; hint: string; rows?: number };
const fields: Record<ClinicalDocumentKind, Field[]> = {
  receta: [
    { key: "indicacion", label: "Indicación o motivo", hint: "Completar según evaluación profesional" },
    { key: "prescripcion", label: "Otras prescripciones en texto libre (opcional)", hint: "Una por línea: medicamento — pauta", rows: 3 },
    { key: "instrucciones", label: "Instrucciones al paciente", hint: "Indicaciones complementarias", rows: 3 },
  ],
  receta_magistral: [
    { key: "indicacion", label: "Indicación o motivo", hint: "Completar según evaluación profesional" },
    { key: "prescripcion", label: "Fórmula magistral", hint: "Componentes, concentración, forma farmacéutica y cantidad total", rows: 5 },
    { key: "instrucciones", label: "Instrucciones al paciente", hint: "Modo de uso, frecuencia y duración", rows: 3 },
  ],
  orden: [
    { key: "diagnostico", label: "Diagnóstico o justificación clínica", hint: "Motivo por el que se solicita" },
    { key: "examenes", label: "Exámenes o procedimientos solicitados", hint: "Uno por línea (p. ej. radiografía panorámica)", rows: 5 },
    { key: "observaciones", label: "Observaciones", hint: "Indicaciones para quien realiza el examen", rows: 3 },
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
const blankContent = (): ClinicalDocumentContent => ({ medicamentos: "", diagnostico: "", examenes: "", indicacion: "", prescripcion: "", instrucciones: "", motivo: "", observaciones: "", vigencia: "", procedimiento: "", descripcion: "", riesgos: "", alternativas: "", declaracion: "" });
const KIND_MENU: Record<ClinicalDocumentKind, { icon: typeof Pill; bar: string; tint: string; color: string }> = {
  receta: { icon: Pill, bar: "bg-[#63b7e8]", tint: "bg-[#dff0fc]", color: "text-[#4aa3d8]" },
  receta_magistral: { icon: FlaskConical, bar: "bg-[#9be8fc]", tint: "bg-[#e6f9fe]", color: "text-[#6cd3ee]" },
  orden: { icon: ClipboardList, bar: "bg-[#27277a]", tint: "bg-[#d4d3e6]", color: "text-[#27277a]" },
  certificado: { icon: ClipboardCheck, bar: "bg-[#6e56f0]", tint: "bg-[#e1dcfa]", color: "text-[#6e56f0]" },
  consentimiento: { icon: ScrollText, bar: "bg-[#e9a23b]", tint: "bg-[#fbeed5]", color: "text-[#d68a1c]" },
};
const normalizeSearch = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[.\-\s]+/g, " ").trim();
const compactRut = (value: string) => value.replace(/[^0-9kK]/g, "").toLowerCase();
function searchPatients(list: Patient[], query: string): Patient[] {
  const text = normalizeSearch(query);
  const rut = compactRut(query);
  if (!text) return [];
  const words = text.split(" ");
  return list.filter(item => {
    const name = normalizeSearch(item.name);
    return words.every(word => name.includes(word)) || (rut.length >= 3 && compactRut(item.rut).includes(rut));
  }).slice(0, 8);
}
const cardClass = "rounded-xl border border-[#e6e4ee] bg-white p-4";
const inputClass = "mt-1 min-h-11 w-full rounded-lg border border-[#d2d4df] bg-white px-3 py-2 text-sm text-[#35343f] outline-none focus:border-[#75669d] focus:ring-2 focus:ring-[#473a6d]/15";
const formatDate = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "Fecha sin registrar" : new Intl.DateTimeFormat("es-CL", { dateStyle: "long", timeZone: "America/Santiago" }).format(date);
};

const SHARE_NOUN: Record<ClinicalDocumentKind, string> = { receta: "receta médica", receta_magistral: "receta magistral", orden: "orden médica", certificado: "certificado médico", consentimiento: "consentimiento informado" };
/** Logo de WhatsApp (burbuja con auricular) para reconocer el botón de un vistazo. */
const WhatsAppIcon = () => <svg viewBox="0 0 24 24" className="size-5 shrink-0" aria-hidden="true" data-testid="whatsapp-icon"><path fill="#25D366" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Z"/><path fill="#fff" d="M16.9 14.3c-.2-.1-1.4-.7-1.6-.8s-.4-.1-.5.1-.6.8-.8.9-.3.2-.5.1a6.6 6.6 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.300.1-.1 0-.3 0-.4l-.7-1.700c-.2-.4-.4-.4-.5-.4h-.5a.9.9 0 0 0-.7.3 2.800 2.800 0 0 0-.9 2.100 4.900 4.900 0 0 0 1 2.600 11.200 11.200 0 0 0 4.300 3.800c1.600.700 2.200.700 3 .600a2.500 2.500 0 0 0 1.700-1.200 2 2 0 0 0 .1-1.200c-.1-.1-.2-.2-.5-.3Z"/></svg>;
const STATUS_LABEL: Record<string, string> = { borrador: "Borrador", emitido: "Emitido", anulado: "Anulado", reemplazado: "Reemplazado" };
const isIssued = (doc: { status: string }) => doc.status !== "borrador";
/** Tratamiento del autor: el que eligió en su perfil (authorTitle) o, si no llega, el del nombre guardado. */
const doctorTitle = (doc: { createdByName: string; authorTitle?: string | null }) => asProfessionalTitle(doc.authorTitle ?? /^(Dr\(a\)\.|Dra\.|Dr\.)/.exec(doc.createdByName)?.[1]);
const authorName = (doc: { createdByName: string; authorTitle?: string | null }) => doc.createdByName ? withTitle(doc.createdByName, doctorTitle(doc)) : "";
const qrSvg = (url: string) => { const qr = qrcode(0, "M"); qr.addData(url); qr.make(); return qr.createSvgTag({ cellSize: 3, margin: 0, scalable: true }); };

/** Documento nuevo abierto desde otra pantalla (riel de la evolución): paciente, tipo y datos iniciales. Se monta con `key` = nonce. */
export type DocumentStart = { patientId: number; kind: ClinicalDocumentKind; content?: Partial<ClinicalDocumentContent>; nonce: number };

export function DocumentationPanel({ patients, budgetCounts, onOpenBudgets, embeddedPatientId, start }: {
  patients: Patient[];
  budgetCounts: Record<number, number>;
  onOpenBudgets: (patientId: number) => void;
  /** Cuando se indica, el panel vive dentro de la ficha de ese paciente y no muestra selector. */
  embeddedPatientId?: number;
  start?: DocumentStart | null;
}) {
  const embedded = embeddedPatientId !== undefined;
  const [requestedPatientId, setPatientId] = useState(start?.patientId ?? embeddedPatientId ?? 0);
  const patientId = embedded ? (patients.some(item => item.id === embeddedPatientId) ? embeddedPatientId : 0) : patients.some(item => item.id === requestedPatientId) ? requestedPatientId : 0;
  const [query, setQuery] = useState("");
  const searchResults = useMemo(() => searchPatients(patients, query), [patients, query]);
  const patient = patients.find(item => item.id === patientId) ?? null;
  const [kind, setKind] = useState<ClinicalDocumentKind>(start?.kind ?? "receta");
  const [composing, setComposing] = useState(Boolean(start));
  const composeRef = useRef<HTMLElement | null>(null);
  // Abierto desde el riel: se lleva la vista al formulario (en iPhone queda debajo de la búsqueda de paciente).
  useEffect(() => { if (!start) return; const timer = window.setTimeout(() => scrollBelowHeader(composeRef.current), 80); return () => window.clearTimeout(timer); }, [start]);
  const previewRef = useRef<HTMLElement | null>(null);
  const [content, setContent] = useState<ClinicalDocumentContent>(() => ({ ...blankContent(), ...Object.fromEntries(Object.entries(start?.content ?? {}).filter(([, v]) => typeof v === "string")) as ClinicalDocumentContent }));
  const [documentsState, setDocumentsState] = useState<{ patientId: number; documents: SavedDocument[]; error: string }>({ patientId: 0, documents: [], error: "" });
  const [activeDocumentId, setActiveDocumentId] = useState<number | null>(null);
  const [clinic, setClinic] = useState<ClinicInfo | null>(null);
  const [documentMark, setDocumentMark] = useState("");
  const [saving, setSaving] = useState(false);
  const [replacingId, setReplacingId] = useState<number | null>(null);
  const prestador = usePrestador();
  const registration = prestador.registration;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const documents = documentsState.patientId === patientId ? documentsState.documents : [];
  const activeDocument = documents.find(item => item.id === activeDocumentId) ?? null;
  const printableMark = useTrimmedMark(activeDocument?.documentMark ?? "");
  // Cmd+P o Compartir → Imprimir con un documento abierto: también se imprime solo el documento (no la app entera).
  useEffect(() => {
    if (!activeDocument) return;
    const before = () => { if (!document.documentElement.classList.contains(PRINT_CLASS)) mountPrintCopy(document.getElementById("documentation-print")); };
    window.addEventListener("beforeprint", before);
    return () => window.removeEventListener("beforeprint", before);
  }, [activeDocument]);
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
  const patchSignature = (documentId: number, signature: SignatureView | null) => setDocumentsState(previous => ({ ...previous, documents: previous.documents.map(item => item.id === documentId ? { ...item, signature } : item) }));
  // Mientras el paciente firma desde su teléfono, se vuelve a leer la ficha para ver la firma apenas llega.
  const refreshDocuments = useCallback(() => {
    if (!patientId) return;
    void fetch(`/api/documentos?patientId=${patientId}`, { cache: "no-store" }).then(async response => {
      const data = await response.json() as { documents?: SavedDocument[] };
      if (response.ok && data.documents) setDocumentsState({ patientId, documents: data.documents, error: "" });
    }).catch(() => undefined);
  }, [patientId]);
  const act = async (path: string, doc: SavedDocument, done: string) => {
    if (busy) return false;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: doc.id }) });
      const data = await response.json() as { document?: SavedDocument; replacedId?: number | null; error?: string };
      if (!response.ok || !data.document) throw new Error(data.error || "No se pudo completar la acción.");
      patchDocument(data.document, data.replacedId); setNotice(done); return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo completar la acción."); return false; }
    finally { setBusy(false); }
  };
  /** WhatsApp: abre el menú de compartir del teléfono con el PDF adjunto (elige el chat del paciente); si no se puede adjuntar, descarga el PDF y abre el chat con el mensaje. */
  const shareDocumentPdf = async (doc: SavedDocument) => {
    if (!patient || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/documentos/pdf?id=${doc.id}`, { cache: "no-store" });
      if (!response.ok) throw new Error((await response.json().catch(() => null) as { error?: string } | null)?.error || "No se pudo generar el PDF.");
      const blob = await response.blob();
      const noun = SHARE_NOUN[doc.kind];
      const file = new File([blob], `${doc.kind.replace(/_/g, "-")}-${String(doc.id).padStart(5, "0")}.pdf`, { type: "application/pdf" });
      const message = `Hola ${patient.name.trim().split(/\s+/)[0] ?? ""}, te enviamos${clinic?.clinicName ? ` desde ${clinic.clinicName}` : ""} tu ${noun} en PDF.`;
      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], text: message }); setNotice(`Elige WhatsApp y luego el chat de ${patient.name}.`); }
        catch (shareError) { if ((shareError as Error)?.name !== "AbortError") throw shareError; }
      } else {
        const url = URL.createObjectURL(blob);
        const link = window.document.createElement("a"); link.href = url; link.download = file.name; link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 10000);
        window.open(`https://wa.me/?text=${encodeURIComponent(`${message} Te lo adjunto en este chat.`)}`, "_blank", "noopener");
        setNotice(`El PDF se descargó. En WhatsApp elige el chat de ${patient.name} y adjunta el archivo.`);
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo preparar el PDF."); }
    finally { setBusy(false); }
  };
  /** Correo: el servidor arma el PDF y lo envía desde el correo conectado del profesional, previa confirmación. */
  const emailDocumentPdf = async (doc: SavedDocument) => {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const preview = await fetch(`/api/documentos/enviar?id=${doc.id}`, { cache: "no-store" });
      const previewData = await preview.json().catch(() => null) as { preview?: { patientName: string; to: string; from: string }; error?: string } | null;
      if (!preview.ok || !previewData?.preview) throw new Error(previewData?.error || "No se pudo preparar el correo.");
      if (!window.confirm(`¿Enviar el PDF a ${previewData.preview.patientName} (${previewData.preview.to}) desde ${previewData.preview.from}?`)) return;
      const response = await fetch("/api/documentos/enviar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: doc.id }) });
      const data = await response.json().catch(() => null) as { to?: string; error?: string } | null;
      if (!response.ok) throw new Error(data?.error || "No se pudo enviar el correo.");
      setNotice(`PDF enviado a ${data?.to ?? previewData.preview.to}.`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo enviar el correo."); }
    finally { setBusy(false); }
  };
  const issue = (doc: SavedDocument) => { if (window.confirm("¿Desea emitir este documento? Quedará bloqueado y con un QR de verificación. Para cambiarlo deberá crear una versión nueva.")) void act("/api/documentos/emitir", doc, "Documento emitido con QR de verificación. Ya puedes imprimirlo."); };
  const canIssueReceta = registration?.status === "aprobado";
  // Receta: borrador solo si el profesional está habilitado; emitida solo si trae el QR de habilitación (obligatorio).
  const printBlocked = (doc: SavedDocument) => requiresHabilitacionQr(doc.kind) && (doc.status === "borrador" ? !canIssueReceta : !doc.registration?.qrUrl);
  // Imprimir y «Generar certificado en PDF» usan el mismo diálogo de impresión del dispositivo (allí se elige «Guardar como PDF»).
  // Un borrador se emite primero (con confirmación) para que el documento impreso lleve su QR de verificación.
  const printDocument = async (doc: SavedDocument) => {
    if (printBlocked(doc)) { setError(`${habilitacionNoun(doc.kind).esta} no se puede imprimir sin el QR de habilitación de la Superintendencia de Salud.`); return; }
    if (doc.status === "emitido") { printNode(document.getElementById("documentation-print")); return; }
    if (doc.status !== "borrador" || busy) return;
    if (!window.confirm("Para imprimir o guardar en PDF el documento se emite primero: quedará bloqueado y con un QR de verificación. ¿Desea continuar?")) return;
    if (await act("/api/documentos/emitir", doc, "Documento emitido con QR de verificación.")) window.setTimeout(() => printNode(document.getElementById("documentation-print")), 400);
  };
  const removeDraft = async (doc: SavedDocument) => {
    if (busy || doc.status !== "borrador") return;
    if (!window.confirm("¿Desea borrar este borrador? Se eliminará definitivamente. Los documentos emitidos no se borran, solo se anulan.")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/documentos/borrar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: doc.id }) });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo borrar el borrador.");
      setDocumentsState(previous => ({ ...previous, documents: previous.documents.filter(item => item.id !== doc.id) }));
      setActiveDocumentId(null); setNotice("Borrador borrado.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo borrar el borrador."); }
    finally { setBusy(false); }
  };
  const annul = (doc: SavedDocument) => { if (window.confirm("¿Desea anular este documento? Nunca se borra, pero la verificación por QR lo mostrará como anulado y no podrá deshacerse.")) void act("/api/documentos/anular", doc, "Documento anulado. La verificación por QR lo muestra como anulado."); };

  const hasContent = fields[kind].some(field => content[field.key]?.trim()) || (kind === "receta" && parseMedications(content.medicamentos).length > 0);
  const saveDraft = async () => {
    if (!patient || !hasContent || saving) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/documentos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patientId: patient.id, kind, content, replacesId: replacingId }) });
      const data = await response.json() as { document?: SavedDocument; error?: string };
      if (!response.ok || !data.document) throw new Error(data.error || "No se pudo guardar el borrador.");
      setDocumentsState(previous => ({ patientId: patient.id, documents: [data.document!, ...(previous.patientId === patient.id ? previous.documents : [])], error: "" }));
      setActiveDocumentId(data.document.id);
      setContent(blankContent()); setReplacingId(null); setComposing(false);
      window.setTimeout(() => previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
      setNotice("Borrador guardado. Revísalo; puedes emitirlo con QR, guardarlo en PDF o imprimirlo.");
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
    {!embedded && <section className="surface">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-lg font-semibold text-[#35343f]">Documentos del paciente</h2><p className="mt-1 max-w-3xl text-sm text-[#615f73]">Prepara recetas, certificados y consentimientos editables. Se guardan como borradores en la ficha elegida; puedes revisarlos e imprimirlos.</p></div>
        {patient && <button type="button" onClick={() => onOpenBudgets(patient.id)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#b9b1ce] px-3 text-sm font-semibold text-[#473a6d] hover:bg-[#f3f1f7]"><FileText className="size-4"/>Presupuestos ({budgetCounts[patient.id] ?? 0})</button>}
      </div>
      <div className="mt-5 max-w-xl text-sm font-semibold text-[#35343f]">
        <label htmlFor="documentation-patient-search">Buscar paciente por nombre o RUT</label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 mt-0.5 size-4 -translate-y-1/2 text-[#6b6a7c]"/>
          <input id="documentation-patient-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Ej.: Ana Pérez o 12.345.678-5" autoComplete="off" className={inputClass + " pl-9"} data-testid="documentation-patient-search"/>
        </div>
        {patient && !query.trim() && <p className="mt-2 flex items-center justify-between gap-3 rounded-lg bg-[#f3f1f7] px-3 py-2 font-normal text-[#473a6d]"><span>Paciente: <strong className="font-semibold">{patient.name}</strong>{patient.rut ? ` · ${patient.rut}` : ""}</span><button type="button" onClick={() => { setPatientId(0); setActiveDocumentId(null); setContent(blankContent()); setComposing(false); setNotice(""); }} className="font-semibold underline">Cambiar</button></p>}
        {query.trim() && <ul className="mt-2 max-h-72 divide-y divide-[#eceaf2] overflow-auto rounded-lg border border-[#e6e4ee] bg-white font-normal" role="listbox" aria-label="Resultados">
          {searchResults.map(item => <li key={item.id}><button type="button" role="option" aria-selected={item.id === patientId} onClick={() => { setPatientId(item.id); setQuery(""); setActiveDocumentId(null); setContent(blankContent()); setComposing(false); setNotice(""); }} className="flex min-h-11 w-full flex-col items-start px-3 py-2 text-left hover:bg-[#f7f6fa]"><span className="font-semibold text-[#35343f]">{item.name}</span><span className="text-xs text-[#6b6a7c]">{item.rut || "Sin RUT"}</span></button></li>)}
          {!searchResults.length && <li className="px-3 py-3 text-[#6b6a7c]">Sin resultados para esa búsqueda.</li>}
        </ul>}
      </div>
      {!patients.length && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">Registra o importa un paciente para crear documentos en su ficha.</p>}
      {!!patients.length && !patient && !query.trim() && <p className="mt-3 text-sm text-[#615f73]">Escribe el nombre o el RUT para abrir los documentos del paciente.</p>}
    </section>}

    {patient && activeDocument && activeContent && <section className="surface" aria-label="Vista previa del documento" ref={previewRef}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden"><div><p className="text-xs font-semibold uppercase tracking-wide text-[#6b5d8e]">Vista previa · {(STATUS_LABEL[activeDocument.status] ?? activeDocument.status).toLowerCase()}</p><h2 className="mt-1 text-lg font-semibold">{activeDocument.title}</h2></div><div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => { setKind(activeDocument.kind); setComposing(true); setContent({ ...blankContent(), ...activeContent }); setReplacingId(activeDocument.status === "emitido" ? activeDocument.id : null); setNotice(activeDocument.status === "emitido" ? "Se cargó el texto para crear una versión nueva. Al emitirla, la versión anterior quedará como reemplazada." : "Se cargó el texto para crear una nueva versión; el borrador anterior se conserva."); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[#b9b1ce] px-4 text-sm font-semibold text-[#473a6d] hover:bg-[#f3f1f7]"><Pencil className="size-4"/>{isIssued(activeDocument) ? "Crear versión nueva" : "Editar una copia"}</button>
        {(activeDocument.status === "borrador" || activeDocument.status === "emitido") && <>
          {activeDocument.status === "borrador" && <button type="button" disabled={busy || (requiresHabilitacionQr(activeDocument.kind) && !canIssueReceta)} title={requiresHabilitacionQr(activeDocument.kind) && !canIssueReceta ? `Sube y espera la aprobación de tu certificado de inscripción para emitir ${habilitacionNoun(activeDocument.kind).emitir}` : undefined} onClick={() => issue(activeDocument)} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[#473a6d] px-4 text-sm font-semibold text-[#473a6d] hover:bg-[#f3f1f7] disabled:opacity-50">{busy ? <LoaderCircle className="size-4 animate-spin"/> : <ShieldCheck className="size-4"/>}Emitir con QR</button>}
          <button type="button" data-testid="documentation-save-pdf" disabled={busy || printBlocked(activeDocument)} onClick={() => void printDocument(activeDocument)} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#473a6d] px-4 text-sm font-semibold text-white hover:bg-[#3a2f5a] disabled:opacity-50"><FileDown className="size-4"/>Generar certificado en PDF</button>
          <button type="button" data-testid="documentation-print-button" disabled={busy || printBlocked(activeDocument)} onClick={() => void printDocument(activeDocument)} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#473a6d] px-4 text-sm font-semibold text-white hover:bg-[#3a2f5a] disabled:opacity-50"><Printer className="size-4"/>Imprimir</button>
          {activeDocument.status === "emitido" && !printBlocked(activeDocument) && (() => {
            const doc = activeDocument;
            const buttonClass = "inline-flex min-h-11 items-center gap-2 rounded-lg border border-[#b9b1ce] px-4 text-sm font-semibold text-[#473a6d] hover:bg-[#f3f1f7] disabled:cursor-not-allowed disabled:opacity-50";
            const noun = SHARE_NOUN[doc.kind];
            return <>
              <button type="button" data-testid="documentation-send-whatsapp" disabled={busy} onClick={() => void shareDocumentPdf(doc)} className={buttonClass}><WhatsAppIcon/>Enviar PDF por WhatsApp</button>
              <button type="button" data-testid="documentation-send-email" disabled={busy || !patient.email} title={patient.email ? undefined : "Agrega un correo al paciente"} onClick={() => void emailDocumentPdf(doc)} className={buttonClass}><Mail className="size-5" aria-hidden="true"/>Enviar PDF por correo</button>
              {!patient.email && <p className="basis-full text-xs text-[#615f73]" data-testid="documentation-send-missing">{`Agrega el correo del paciente para enviar el ${noun} por correo.`}</p>}
            </>;
          })()}
          {activeDocument.status === "borrador" && <button type="button" data-testid="documentation-delete-draft" disabled={busy} onClick={() => void removeDraft(activeDocument)} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-rose-300 px-4 text-sm font-semibold text-rose-800 hover:bg-rose-50 disabled:opacity-50"><Trash2 className="size-4"/>Borrar</button>}
          {activeDocument.status === "emitido" && <button type="button" disabled={busy} onClick={() => annul(activeDocument)} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-rose-300 px-4 text-sm font-semibold text-rose-800 hover:bg-rose-50 disabled:opacity-50"><Trash2 className="size-4"/>Anular</button>}
        </>}
      </div></div>
      {(error || notice) && <p role={error ? "alert" : "status"} className={`mb-4 rounded-lg p-3 text-sm print:hidden ${error ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-900"}`}>{error || notice}</p>}
      {activeDocument.status === "borrador" && <p className="mb-4 rounded-lg bg-[#f3f1f7] p-3 text-sm text-[#473a6d] print:hidden">Este documento es un borrador. Al imprimir o guardar en PDF se emite primero con su código de verificación QR (o pulsa «Emitir con QR»).{requiresHabilitacionQr(activeDocument.kind) && !canIssueReceta && ` Para emitir ${habilitacionNoun(activeDocument.kind).emitir} primero debes subir tu certificado de inscripción (tarjeta «Habilitación para emitir recetas») y esperar su aprobación.`}</p>}
      {activeDocument.kind === "consentimiento" && patient && (activeDocument.status === "borrador" || activeDocument.status === "emitido" || activeDocument.signature) && <div className="mb-4 print:hidden">
        <ConsentSigningCard key={activeDocument.id} documentId={activeDocument.id} issued={activeDocument.status === "emitido" || Boolean(activeDocument.signature?.status === "firmado")} signature={activeDocument.signature} patient={{ name: patient.name, phone: patient.phone, email: patient.email }}
          onChange={next => patchSignature(activeDocument.id, next)} onRefresh={refreshDocuments}/>
      </div>}
      {(() => {
        const doc = activeDocument;
        const prescription = isPrescriptionKind(doc.kind);
        // Emitido: solo la habilitación que trae el documento. Borrador: vista previa con la propia, si está habilitado.
        const reg: PublicRegistration | null = doc.registration ?? (doc.status === "borrador" && registration?.status === "aprobado" ? registration : null);
        // La receta lleva SIEMPRE el QR de habilitación de la Superintendencia: sin él no se imprime (no hay opción para ocultarlo).
        const missingQr = requiresHabilitacionQr(doc.kind) && !reg?.qrUrl;
        const doctorName = reg?.fullName ? `${doctorTitle(doc)} ${reg.fullName}` : authorName(doc) || "Profesional";
        const doctorRut = reg?.run ? formatChileanRut(reg.run) : "";
        const professionLine = reg ? `${reg.profession} (${registrationLine(reg)})` : "";
        const clinicAddress = [clinic?.address, clinic?.city].filter(Boolean).join(", ");
        const contact = [clinic?.phone, clinic?.email].filter(Boolean).join(" · ");
        const medications = doc.kind === "receta" ? parseMedications(activeContent.medicamentos) : [];
        const patientDocument = patient.rut ? (isValidChileanRut(patient.rut) ? formatChileanRut(patient.rut) : patient.rut) : "Sin registrar";
        const patientAddress = formatAddress(patient.address);
        const signature = <div className="flex w-[7cm] max-w-full flex-col items-center justify-end text-center [break-inside:avoid]" data-testid="signature-block">
          <div className="flex h-[2.8cm] w-[6.5cm] max-w-full items-end justify-center" data-testid="signature-box">{printableMark && <Image src={printableMark} alt="Firma o timbre del profesional" width={900} height={400} unoptimized className="h-full w-full object-contain object-bottom"/>}</div>
          <div className="mt-1 w-full border-t border-[#555] pt-1.5 text-[12px] leading-snug text-[#1f1d2b]" data-testid="signature-name"><p className="font-semibold">{doctorName}</p>{doctorRut && <p>RUT {doctorRut}</p>}{reg && <p>{professionLine}</p>}</div>
        </div>;
        const verificacion = doc.verifyToken && doc.contentHash && <div className="flex items-center gap-2 text-left [break-inside:avoid]" data-testid="verificacion-row">
          <div className="size-[1.6cm] shrink-0 bg-white [&_svg]:size-full" role="img" aria-label="Código QR de verificación del documento" dangerouslySetInnerHTML={{ __html: qrSvg(verificationUrl(window.location.origin, doc.verifyToken)) }}/>
          <div className="min-w-0 text-[9.5px] leading-snug text-[#55536a]"><p className="font-semibold uppercase tracking-wider text-[#473a6d]">Verificación de documento</p><p>Escanee para confirmar que fue emitido desde Gestión Dental y está vigente. Código <span className="font-mono font-semibold">{shortCode(doc.contentHash)}</span> · {formatDate(doc.issuedAt || doc.createdAt)}.{!prescription && " No es firma electrónica avanzada."}</p></div>
        </div>;
        return <article id="documentation-print" className="mx-auto max-w-[800px] overflow-hidden rounded-xl border border-[#e6e4ee] bg-white px-4 py-5 text-[#1f1d2b] shadow-sm sm:px-8 sm:py-7 print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none [print-color-adjust:exact] [-webkit-print-color-adjust:exact]" data-kind={doc.kind}>
          <header className="flex flex-col gap-3 border-b-2 border-[#473a6d] pb-3 sm:flex-row sm:items-start sm:justify-between sm:gap-5 print:flex-row print:items-start print:justify-between print:gap-5" data-testid="document-header">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                {clinic?.logo && <Image src={clinic.logo} alt="Logo de la clínica" width={200} height={200} unoptimized className="max-h-12 max-w-20 object-contain"/>}
                <p className="text-xl font-bold uppercase tracking-wide text-[#473a6d]" data-testid="document-clinic">{clinic?.clinicName || "Consulta odontológica"}</p>
              </div>
              <p className="mt-1.5 text-lg font-bold leading-tight" data-testid="document-doctor">{doctorName}</p>
              <div className="mt-0.5 text-[12px] leading-snug text-[#3b3950]" data-testid="document-doctor-details">
                {doctorRut && <p>RUT {doctorRut}</p>}
                {reg && <p>{professionLine}</p>}
                {!!reg?.specialties.length && <p>{reg.specialties.join(" · ")}</p>}
                {clinicAddress && <p>{clinicAddress}</p>}
                {contact && <p>{contact}</p>}
              </div>
            </div>
            {reg?.qrUrl && <div className="flex w-full max-w-[6.3cm] shrink-0 items-center gap-2.5 rounded-lg sm:w-[6.3cm] print:w-[6.3cm] border border-[#cfcbe0] p-2 [break-inside:avoid]" data-testid="habilitacion-row" title={qrCaption(reg.regSis)}>
              <div className="size-[2.2cm] shrink-0 bg-white [&_svg]:size-full" role="img" aria-label="Código QR de habilitación del profesional (Superintendencia de Salud)" data-testid="habilitacion-qr" dangerouslySetInnerHTML={{ __html: qrSvg(reg.qrUrl) }}/>
              <div className="min-w-0 text-[10px] leading-snug text-[#3b3950]"><p className="font-semibold text-[#1f1d2b]">Verifique la habilitación del profesional</p><p>Superintendencia de Salud</p><p className="mt-1 font-semibold text-[#1f1d2b]">REG-SIS N° {reg.regSis}</p>{reg.validationCode && <p className="mt-0.5">Código <span className="font-mono">{reg.validationCode}</span></p>}</div>
            </div>}
          </header>
          {missingQr ? <div className="mt-6 rounded-lg border-2 border-rose-300 bg-rose-50 p-5 text-center text-sm text-rose-900" data-testid={prescription ? "receta-sin-qr" : "consent-sin-qr"} role="alert"><p className="font-bold">{habilitacionNoun(doc.kind).esta} no se puede imprimir sin el QR de habilitación de la Superintendencia de Salud.</p><p className="mt-1">Sube tu certificado de inscripción (PDF) en «Habilitación para emitir recetas» y vuelve a abrir {prescription ? "la receta" : "el consentimiento"}.</p></div> : <>
          <div className="mt-3 grid grid-cols-[3.5rem_minmax(0,1fr)_3.5rem] items-baseline sm:grid-cols-[6rem_minmax(0,1fr)_6rem] print:grid-cols-[6rem_minmax(0,1fr)_6rem]">
            <span/>
            <h2 className="text-center text-[15px] font-semibold uppercase tracking-[0.12em] text-[#473a6d] sm:tracking-[0.25em] print:tracking-[0.25em]" data-testid="document-title">{doc.title}</h2>
            <span className="text-right text-[11px] text-[#6b6a7c]">N° {String(doc.id).padStart(5, "0")}</span>
          </div>
          {doc.status === "anulado" && <p className="mt-2 bg-rose-100 py-1.5 text-center text-sm font-bold uppercase tracking-widest text-rose-900">Documento anulado</p>}
          {doc.status === "reemplazado" && <p className="mt-2 bg-orange-100 py-1.5 text-center text-sm font-bold uppercase tracking-widest text-orange-900">Documento reemplazado por una versión nueva</p>}
          {doc.status === "borrador" && <p className="mt-2 bg-[#f3f1f7] py-1.5 text-center text-xs font-semibold uppercase tracking-widest text-[#615f73]">Borrador · sin verificación</p>}
          <section className="mt-3 grid gap-x-6 border-b sm:grid-cols-[minmax(0,1fr)_auto] print:grid-cols-[minmax(0,1fr)_auto] border-[#cfcbe0] pb-3 text-[13px] leading-relaxed" data-testid="document-patient">
            <div className="min-w-0">
              <p><span className="font-semibold">Paciente:</span> {patient.name}</p>
              <p><span className="font-semibold">Nro. de documento:</span> {patientDocument}</p>
              <p><span className="font-semibold">Edad:</span> {patientAge === null ? "Sin registrar" : `${patientAge} años`}</p>
              {patientAddress && <p><span className="font-semibold">Dirección:</span> {patientAddress}</p>}
            </div>
            <p className="sm:text-right print:text-right"><span className="font-semibold">Fecha emisión:</span><br className="hidden sm:inline print:inline"/> {formatDate(doc.issuedAt || doc.createdAt)}</p>
          </section>
          {prescription ? <div className="mt-3 space-y-3 text-[13px] leading-relaxed">
            {activeContent.indicacion?.trim() && <p><span className="font-semibold">Diagnóstico / indicación:</span> {activeContent.indicacion.trim()}</p>}
            <section data-testid="prescription">
              <h3 className="font-serif text-2xl italic leading-none text-[#473a6d]">Rp.</h3>
              {medications.length + prescriptionLines.length ? <ol className="mt-2 space-y-2.5">
                {medications.map((item, index) => <li key={`m${index}`} className="[break-inside:avoid]" data-testid="medication">
                  <p className="text-[14px] font-bold">{index + 1}. {item.nombre}</p>
                  {medicationLine(item) && <p data-testid="medication-line">{medicationLine(item)}</p>}
                  {item.indicaciones && <p className="whitespace-pre-line">{item.indicaciones}</p>}
                  {item.cantidad && <p>Cantidad a dispensar: {item.cantidad}</p>}
                </li>)}
                {prescriptionLines.map((line, index) => <li key={`l${index}`} className="[break-inside:avoid]"><p className="text-[14px] font-bold">{medications.length + index + 1}. {line.name}</p>{line.detail && <p>{line.detail}</p>}</li>)}
              </ol> : <p className="mt-2 text-[#615f73]">—</p>}
            </section>
            {activeContent.instrucciones?.trim() && <section><h3 className="font-semibold">Indicaciones al paciente</h3><p className="whitespace-pre-wrap">{activeContent.instrucciones.trim()}</p></section>}
          </div> : <div className="mt-3 space-y-3 print:space-y-2">{fields[doc.kind].map(field => <section key={field.key}><h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#6b5d8e]">{field.label}</h3><p className="mt-1 min-h-5 whitespace-pre-wrap text-sm leading-relaxed">{activeContent[field.key]?.trim() || "—"}</p></section>)}</div>}
          {doc.kind === "consentimiento" && <p className="mt-4 rounded-lg border border-[#dddbe6] p-3 text-sm leading-relaxed print:p-2 print:text-xs">Borrador para revisión clínica. Este texto no sustituye la conversación con el paciente ni la verificación del contenido aplicable al procedimiento y sus circunstancias.</p>}
          {doc.kind === "consentimiento" ? <>
            <footer className="mt-12 grid gap-10 text-center text-xs sm:grid-cols-2 print:mt-6 print:grid-cols-2 [break-inside:avoid]">
              <div className="flex justify-center">{signature}</div>
              <div className="flex min-h-[3.4cm] flex-col justify-end [break-inside:avoid]" data-testid="patient-signature-block">
                {doc.signature?.status === "firmado" && <div className="mx-auto mb-1 h-[2.4cm] w-[6cm] max-w-full"><PatientSignatureImage signature={doc.signature}/></div>}
                <div className="w-full border-t border-[#555] pt-1.5 text-[12px]"><span className="font-semibold">{doc.signature?.status === "firmado" ? doc.signature.signerName : patient.name}</span><br/>Firma del paciente
                  {doc.signature?.status === "firmado" && <span className="block text-[10px] leading-snug text-[#55536a]" data-testid="patient-signature-note">{doc.signature.signerRole === "representante" ? `${doc.signature.signerRelation ? `${doc.signature.signerRelation}, ` : ""}${isSignerRole(doc.signature.signerRole) ? SIGNER_ROLE_LABEL[doc.signature.signerRole].toLowerCase() : "representante"} de ${patient.name}. ` : ""}Firmado electrónicamente el {formatDate(doc.signature.signedAt)}{isSignMethod(doc.signature.method) ? ` (${SIGN_METHOD_LABEL[doc.signature.method]})` : ""}. Firma electrónica simple.</span>}
                </div></div>
            </footer>
            {verificacion && <div className="mt-4" data-testid="qr-strip">{verificacion}</div>}
          </> : <footer className="mt-10 grid items-end gap-6 sm:grid-cols-[minmax(0,1fr)_7cm] print:mt-6 print:grid-cols-[minmax(0,1fr)_7cm] [break-inside:avoid]">
            <div className="order-2 sm:order-1 print:order-1" data-testid="qr-strip">{verificacion}</div>
            <div className="order-1 justify-self-center sm:order-2 sm:justify-self-end print:order-2 print:justify-self-end">{signature}</div>
          </footer>}
          </>}
        </article>;
      })()}
    </section>}

    {patient && <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,.82fr)]">
      <section ref={composeRef} className="surface min-w-0" data-testid="documentation-compose">
        {!composing ? <div data-testid="documentation-menu">
          <h2 className="text-lg font-semibold">Nuevo documento</h2>
          <p className="text-sm text-[#615f73]">Elige el tipo de documento que necesitas para este paciente.</p>
          <ul className="mt-4 space-y-3">
            {CLINICAL_DOCUMENT_KINDS.map(value => { const meta = KIND_MENU[value]; const Icon = meta.icon; return <li key={value}>
              <button type="button" onClick={() => { setKind(value); setComposing(true); setNotice(""); setError(""); }} data-testid={`documentation-kind-${value}`} className="flex min-h-20 w-full items-center gap-4 overflow-hidden rounded-xl bg-white pr-4 text-left shadow-[0_2px_10px_rgba(0,0,0,.08)] hover:bg-[#faf9fc]">
                <span className={`self-stretch w-2 shrink-0 ${meta.bar}`}/>
                <span className={`flex size-12 shrink-0 items-center justify-center rounded-full ${meta.tint} ${meta.color}`}><Icon className="size-6"/></span>
                <span className="flex-1 text-base font-semibold text-[#1b1a2e]">{CLINICAL_DOCUMENT_LABEL[value]}</span>
                <ChevronRight className="size-5 text-[#44425a]"/>
              </button>
            </li>; })}
          </ul>
        </div> : <>
        <div className="flex items-center gap-3"><button type="button" onClick={() => { setComposing(false); setReplacingId(null); setError(""); }} aria-label="Volver a tipos de documento" className="flex size-10 shrink-0 items-center justify-center rounded-full hover:bg-[#f3f1f7]"><ArrowLeft className="size-5"/></button><div><h2 className="text-lg font-semibold">{CLINICAL_DOCUMENT_LABEL[kind]}</h2><p className="text-sm font-semibold text-[#473a6d]" data-testid="documentation-compose-patient">Paciente: {patient.name}</p><p className="text-sm text-[#615f73]">Completa solo los datos que correspondan y guarda para abrir la vista de impresión.</p></div></div>
        {kind === "consentimiento" && <ConsentTemplatePicker onPick={template => {
          if (fields.consentimiento.some(field => content[field.key]?.trim()) && !window.confirm("¿Desea reemplazar lo que ya escribiste por esta plantilla?")) return;
          setContent(previous => ({ ...previous, ...template }));
        }}/>}
        <div className="mt-4 space-y-3">
          {fields[kind].map(field => <Fragment key={field.key}>{kind === "receta" && field.key === "prescripcion" && <MedicationEditor value={content.medicamentos ?? ""} onChange={next => setContent(previous => ({ ...previous, medicamentos: next }))}/>}<label className="block text-sm font-semibold text-[#35343f]">{field.label}
            {field.rows ? <textarea rows={field.rows} value={content[field.key] ?? ""} onChange={event => setContent(previous => ({ ...previous, [field.key]: event.target.value }))} placeholder={field.hint} className={inputClass + " resize-y"}/> : <input id={kind === "consentimiento" ? `consent-${field.key}` : undefined} value={content[field.key] ?? ""} onChange={event => setContent(previous => ({ ...previous, [field.key]: event.target.value }))} placeholder={field.hint} className={inputClass}/>}
          </label></Fragment>)}
        </div>
        {kind === "consentimiento" && <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">Borrador editable. Revisa riesgos y alternativas con el paciente, adapta el contenido al procedimiento y explícalo al paciente. La aplicación no valida legalmente el texto. Al emitirlo, el paciente puede firmarlo en pantalla o desde un enlace, sin costo.</p>}
        {error && <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
        {notice && !error && <p role="status" className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
        <button type="button" onClick={() => void saveDraft()} disabled={!hasContent || saving} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#473a6d] px-4 text-sm font-semibold text-white hover:bg-[#3a2f5a] disabled:cursor-not-allowed disabled:opacity-50">
          {saving ? <LoaderCircle className="size-4 animate-spin"/> : <FileCheck2 className="size-4"/>}{saving ? "Guardando…" : "Guardar borrador"}
        </button>
        </>}
      </section>

      <div className="min-w-0 space-y-6">
        <section className={cardClass}>
          <div className="flex items-center gap-2"><ScrollText className="size-5 text-[#473a6d]"/><h2 className="font-semibold">Documentos guardados</h2></div>
          {documentLoading ? <p className="mt-3 text-sm text-[#615f73]" role="status">Cargando documentos…</p> : documentLoadError ? <p role="alert" className="mt-3 text-sm text-rose-800">{documentLoadError}</p> : documents.length ? <ul className="mt-3 space-y-2">{documents.map(document => <li key={document.id}><button type="button" onClick={() => { setActiveDocumentId(document.id); setNotice(""); }} aria-pressed={activeDocument?.id === document.id} className={`w-full rounded-lg border p-3 text-left ${activeDocument?.id === document.id ? "border-[#9b8cba] bg-[#f4f2f7]" : "border-[#e6e4ee] bg-white hover:bg-[#f8f7fa]"}`}><span className="flex items-center justify-between gap-2"><strong className="text-sm">{document.title}</strong><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${document.status === "emitido" ? "bg-emerald-100 text-emerald-900" : document.status === "anulado" ? "bg-rose-100 text-rose-900" : document.status === "reemplazado" ? "bg-orange-100 text-orange-900" : "bg-[#eeebf3] text-[#473a6d]"}`}>{STATUS_LABEL[document.status] ?? document.status}</span></span><span className="mt-1 block text-xs text-[#615f73]">{formatDate(document.createdAt)}{document.createdByName ? ` · ${authorName(document)}` : ""}</span>{(() => { const mark = signatureListMark(document.kind, document.status, document.signature); return mark ? <span data-testid={`document-signature-${mark.tone}`} className={`mt-2 flex items-center gap-1.5 text-xs font-semibold ${mark.tone === "firmado" ? "text-emerald-800" : "text-amber-800"}`}>{mark.tone === "firmado" ? <CheckCircle2 className="size-4"/> : <PenLine className="size-4"/>}{mark.text}{mark.tone === "firmado" && document.signature?.signedAt ? ` · ${formatDate(document.signature.signedAt)}` : ""}</span> : null; })()}</button></li>)}</ul> : <p className="mt-3 rounded-lg bg-[#f7f6fa] p-3 text-sm text-[#615f73]">Todavía no hay documentos en esta ficha.</p>}
        </section>

        <PrestadorCard state={prestador}/>

        <section className={cardClass} data-testid="signature-pointer">
          <div className="flex items-start gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#eeebf3] text-[#473a6d]"><Pencil className="size-4"/></span><div><h2 className="font-semibold">Mi firma o timbre</h2><p className="mt-1 text-sm text-[#615f73]">Tu firma ahora vive en tu identificación profesional: <strong>Configuración → Profesionales</strong>. Se usa sola en certificados, recetas, consentimientos y presupuestos.</p></div></div>
          {documentMark ? <div className="mt-3 flex h-20 items-center justify-center rounded-lg border border-[#e6e4ee] bg-white p-2"><Image src={documentMark} alt="Tu firma guardada" width={900} height={400} unoptimized className="h-full w-auto max-w-full object-contain"/></div> : <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">Aún no tienes firma guardada.</p>}
        </section>
      </div>
    </div>}


  </div>;
}


const blankMedication = (): Medication => ({ nombre: "", dosis: "", via: "", cantidad: "", posologia: "1", unidad: "comprimido", cada: "", cadaUnidad: "hora", duracion: "", duracionUnidad: "día", indicaciones: "" });
const MED_KEYS = ["nombre", "dosis", "via", "cantidad", "posologia", "unidad", "cada", "cadaUnidad", "duracion", "duracionUnidad", "indicaciones"] as const;
/** Filas tal como se escriben (sin descartar las vacías); al guardar, el servidor limpia y descarta las sin nombre.
 *  Las recetas antiguas (pauta en texto libre, sin unidad) conservan su texto hasta que se complete la posología estructurada. */
function editableMedications(value: string): Medication[] {
  try {
    const list = JSON.parse(value || "[]") as unknown;
    if (Array.isArray(list) && list.length) return list.map(item => {
      const row = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      const legacy = !("unidad" in row) && Boolean(String(row.dosis ?? "").trim());
      const base = legacy ? { ...blankMedication(), posologia: "", unidad: "" } : blankMedication();
      return Object.fromEntries(MED_KEYS.map(key => [key, row[key] === undefined ? base[key] ?? "" : String(row[key] ?? "")])) as Medication;
    });
  } catch { /* texto antiguo o vacío */ }
  return [blankMedication()];
}

/** Medicamentos de la receta, uno por tarjeta, como el «Detalle tratamiento» de MekiDoc: medicamento, posología (cantidad + unidad),
 *  cada, duración, vía, indicaciones y cantidad a dispensar (calculada cuando se puede, editable). */
function MedicationEditor({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const rows = editableMedications(value);
  const emit = (next: Medication[]) => onChange(JSON.stringify(next));
  const update = (index: number, key: keyof Medication, text: string) => emit(rows.map((row, i) => {
    if (i !== index) return row;
    const next: Medication = { ...row, [key]: text };
    if (key !== "cantidad" && key !== "nombre" && key !== "via" && key !== "indicaciones") {
      // La cantidad a dispensar sigue al cálculo mientras no se haya escrito a mano.
      const previousAuto = autoQuantityText(row);
      if (!row.cantidad || row.cantidad === previousAuto) next.cantidad = autoQuantityText(next);
      if (next.unidad) next.dosis = medicationDosis(next);
    }
    return next;
  }));
  const field = "mt-1 min-h-11 w-full rounded-lg border border-[#d2d4df] bg-white px-3 py-2 text-base text-[#35343f] outline-none focus:border-[#75669d] focus:ring-2 focus:ring-[#473a6d]/15";
  const label = "block text-sm font-semibold text-[#35343f]";
  const number = (index: number, key: "posologia" | "cada" | "duracion", value: string, testId: string, aria: string) =>
    <input className={field} type="text" inputMode="decimal" pattern="[0-9]*[.,]?[0-9]*" autoComplete="off" value={value} aria-label={aria} placeholder={key === "posologia" ? "1" : "Ej. 8"}
      onChange={event => update(index, key, event.target.value.replace(/[^0-9.,]/g, "").slice(0, 7))} data-testid={testId}/>;
  const timeSelect = (index: number, key: "cadaUnidad" | "duracionUnidad", value: string, testId: string, aria: string) =>
    <select className={field} value={value} aria-label={aria} onChange={event => update(index, key, event.target.value)} data-testid={testId}>
      {TIME_UNIT_KEYS.map(unit => <option key={unit} value={unit}>{TIME_UNITS[unit].singular}</option>)}
    </select>;
  return <fieldset className="space-y-3" data-testid="medication-editor">
    <legend className="text-sm font-semibold text-[#35343f]">Medicamentos</legend>
    {rows.map((row, index) => {
      const auto = autoQuantityText(row);
      const legacy = !row.unidad && row.dosis.trim();
      const line = medicationLine({ ...row, dosis: row.unidad ? medicationDosis(row) : row.dosis });
      return <div key={index} className="space-y-3 rounded-xl border border-[#e6e4ee] bg-[#faf9fc] p-3 sm:p-4" data-testid="medication-row">
        <div className="flex items-center justify-between gap-2"><p className="text-xs font-bold uppercase tracking-wider text-[#6b5d8e]">Medicamento {index + 1}</p>{rows.length > 1 && <button type="button" onClick={() => emit(rows.filter((_, i) => i !== index))} className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-rose-800 hover:bg-rose-50" aria-label={`Quitar medicamento ${index + 1}`}><Trash2 className="size-4"/>Quitar</button>}</div>
        <label className={label}>Medicamento<input className={field} value={row.nombre} onChange={event => update(index, "nombre", event.target.value)} placeholder="Ej. Amoxicilina 500 mg" autoComplete="off" data-testid="medication-nombre"/></label>
        <div><p className={label} id={`pos-${index}`}>Posología</p>
          <div className="grid grid-cols-[5.5rem_1fr] gap-2" role="group" aria-labelledby={`pos-${index}`}>
            {number(index, "posologia", row.posologia ?? "", "medication-posologia", "Cantidad por toma")}
            <select className={field} value={row.unidad ?? ""} aria-label="Unidad" onChange={event => update(index, "unidad", event.target.value)} data-testid="medication-unidad">
              {!row.unidad && <option value="">Seleccionar</option>}
              {DOSE_UNIT_KEYS.map(unit => <option key={unit} value={unit}>{DOSE_UNITS[unit].label ?? unit}</option>)}
            </select>
          </div></div>
        <div><p className={label} id={`cada-${index}`}>Cada</p>
          <div className="grid grid-cols-[5.5rem_1fr] gap-2" role="group" aria-labelledby={`cada-${index}`}>
            {number(index, "cada", row.cada ?? "", "medication-cada", "Cada cuánto")}
            {timeSelect(index, "cadaUnidad", row.cadaUnidad || "hora", "medication-cada-unidad", "Unidad de frecuencia")}
          </div></div>
        <div><p className={label} id={`dur-${index}`}>Duración</p>
          <div className="grid grid-cols-[5.5rem_1fr] gap-2" role="group" aria-labelledby={`dur-${index}`}>
            {number(index, "duracion", row.duracion ?? "", "medication-duracion", "Duración")}
            {timeSelect(index, "duracionUnidad", row.duracionUnidad || "día", "medication-duracion-unidad", "Unidad de duración")}
          </div></div>
        <label className={label}>Vía
          <select className={field} value={row.via} onChange={event => update(index, "via", event.target.value)} data-testid="medication-via">
            <option value="">Seleccionar</option>
            {row.via && !VIAS.includes(row.via) && <option value={row.via}>{row.via}</option>}
            <optgroup label="Frecuentes en odontología">{VIAS_FRECUENTES.map(via => <option key={`f-${via}`} value={via}>{via}</option>)}</optgroup>
            <optgroup label="Todas (A–Z)">{VIAS.map(via => <option key={via} value={via}>{via}</option>)}</optgroup>
          </select></label>
        <label className={label}>Indicaciones <span className="font-normal text-[#615f73]">(Opcional)</span>
          <textarea className={`${field} min-h-20`} rows={2} value={row.indicaciones ?? ""} onChange={event => update(index, "indicaciones", event.target.value)} placeholder="Ej. Tomar después de las comidas" data-testid="medication-indicaciones"/></label>
        <label className={label}>Cantidad a dispensar
          <input className={field} value={row.cantidad} onChange={event => update(index, "cantidad", event.target.value)} placeholder={auto || "Ej. 1 frasco"} autoComplete="off" data-testid="medication-cantidad"/>
          {auto && row.cantidad === auto && <span className="mt-1 block text-xs font-normal text-[#615f73]">Calculada automáticamente; puedes cambiarla.</span>}
          {auto && row.cantidad && row.cantidad !== auto && <button type="button" onClick={() => update(index, "cantidad", auto)} className="mt-1 block min-h-9 text-left text-sm font-semibold text-[#473a6d] underline">Usar cálculo: {auto}</button>}
        </label>
        {legacy && <label className={label}>Pauta escrita (receta anterior)<input className={field} value={row.dosis} onChange={event => update(index, "dosis", event.target.value)} data-testid="medication-dosis"/><span className="mt-1 block text-xs font-normal text-[#615f73]">Se reemplaza al elegir la unidad de posología.</span></label>}
        {(line || row.cantidad) && <div className="rounded-lg bg-white p-2.5 text-sm text-[#35343f] ring-1 ring-[#e6e4ee]" data-testid="medication-preview"><p className="text-xs font-bold uppercase tracking-wider text-[#6b5d8e]">Así se imprimirá</p>{line && <p>{line}</p>}{row.indicaciones?.trim() && <p className="whitespace-pre-line">{row.indicaciones.trim()}</p>}{row.cantidad && <p>Cantidad a dispensar: {row.cantidad}</p>}</div>}
      </div>;
    })}
    {rows.length < MEDICATION_MAX && <button type="button" onClick={() => emit([...rows, blankMedication()])} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[#b9b1ce] bg-white px-3 text-sm font-semibold text-[#473a6d] hover:bg-[#f3f1f7]" data-testid="medication-add"><FilePlus2 className="size-4"/>Agregar medicamento</button>}
  </fieldset>;
}
