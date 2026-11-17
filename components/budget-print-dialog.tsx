"use client";

import { useEffect, useRef, useState } from "react";
import { Download, ExternalLink, Mail, Printer, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BudgetFormatEditor } from "@/components/budget-format-editor";
import { checkBudgetFormat, previewActions, type BudgetClinicData, type BudgetFormat } from "@/lib/budget-format";
import type { BudgetPlan } from "@/components/budget-plan";

type PrintMode = "detailed" | "total" | "no-prices";

const modes: Array<{ value: PrintMode; title: string; description: string }> = [
  { value: "detailed", title: "Completo", description: "Prestaciones, fases y valores." },
  { value: "total", title: "Solo total", description: "No muestra el detalle de prestaciones." },
  { value: "no-prices", title: "Sin valores", description: "Muestra prestaciones, sin montos." },
];

/**
 * Vista previa del presupuesto: es el PDF real (el mismo código que la descarga y el correo), no una maqueta.
 * Lo que se ve aquí es exactamente lo que recibe el paciente, y el profesional puede cambiar el diseño ahí mismo.
 */
export function BudgetPrintDialog({ open, onOpenChange, budget, patientName }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  budget: BudgetPlan | null;
  patientName: string;
  /** Se conservan por compatibilidad: el PDF toma el nombre y la clínica del perfil en el servidor. */
  professionalName?: string;
  clinicName?: string;
}) {
  return <Dialog open={open && Boolean(budget)} onOpenChange={onOpenChange}>
    <DialogContent data-budget-print-dialog className="max-h-[92vh] w-[calc(100vw-2rem)] max-w-6xl overflow-x-hidden overflow-y-auto sm:max-w-6xl">
      {budget && <BudgetPrintBody key={budget.id} budget={budget} patientName={patientName} onClose={() => onOpenChange(false)}/>}
    </DialogContent>
  </Dialog>;
}

/** Existe solo mientras el diálogo está abierto: cada apertura parte con el estado limpio. */
function BudgetPrintBody({ budget, patientName, onClose }: { budget: BudgetPlan; patientName: string; onClose: () => void }) {
  const allUndefined = budget.items.length > 0 && budget.items.every(item => item.amount === 0);
  const [mode, setMode] = useState<PrintMode>(allUndefined ? "no-prices" : "detailed");
  const [busy, setBusy] = useState<"" | "preview" | "send" | "save">("");
  const [target, setTarget] = useState<{ to: string; from: string } | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  // Diseño: el guardado (lo que usa el correo) y el borrador que se está viendo.
  const [saved, setSaved] = useState<BudgetFormat | null>(null);
  const [draft, setDraft] = useState<BudgetFormat | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [logo, setLogo] = useState({ has: false, embeddable: false });
  const [profileClinic, setProfileClinic] = useState<BudgetClinicData | null>(null);
  // null hasta que el servidor dice si este profesional es el autor: hasta entonces no se ofrece el editor.
  const [editable, setEditable] = useState<boolean | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [renderedKey, setRenderedKey] = useState("");
  const requestToken = useRef(0);
  const [problem, setProblem] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  // URL que el iframe terminó de cargar: imprimir antes de eso imprimiría la hoja anterior o una en blanco.
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const budgetId = budget.id;

  useEffect(() => {
    let live = true;
    fetch("/api/presupuesto/formato").then(r => r.ok ? r.json() as Promise<{ format: BudgetFormat; hasLogo: boolean; logoEmbeddable: boolean; profileClinic?: BudgetClinicData | null }> : Promise.reject(new Error("formato")))
      .then(data => { if (!live) return; setSaved(data.format); setDraft(data.format); setLogo({ has: data.hasLogo, embeddable: data.logoEmbeddable }); setProfileClinic(data.profileClinic ?? null); })
      .catch(() => { if (live) setLoadFailed(true); });
    return () => { live = false; };
  }, []);
  // Al cambiar el formato se pide confirmar de nuevo el envío.
  const chooseMode = (next: PrintMode) => { requestToken.current++; setMode(next); setTarget(null); };
  const changeDraft = (next: BudgetFormat) => { requestToken.current++; setDraft(next); setTarget(null); setNotice(null); };

  const formatReady = Boolean(draft) || loadFailed;
  const checked = draft ? checkBudgetFormat(draft) : null;
  const draftFormat = checked?.ok ? checked.format : null;
  const formatError = checked && !checked.ok ? checked.error : null;
  const draftKey = draftFormat ? JSON.stringify(draftFormat) : "";
  const savedKey = saved ? JSON.stringify(saved) : "";
  // Un diseño inválido cuenta como cambio sin guardar: la vista quedaría desactualizada respecto de lo que se edita.
  const dirty = Boolean(draft && saved) && (Boolean(formatError) || draftKey !== savedKey);
  const wantedKey = mode + "|" + draftKey;
  const inSync = renderedKey === wantedKey;
  const rendering = !inSync && !formatError && !problem && formatReady;
  const canEdit = editable === true && Boolean(draft) && !loadFailed;
  const actions = previewActions({ inSync, hasPdf: Boolean(pdfUrl), problem: Boolean(problem), canEdit, dirty, invalid: Boolean(formatError) });

  // El PDF se vuelve a armar con cada cambio de modo o de diseño (con una pausa corta para no pedir uno por tecla).
  useEffect(() => {
    if (!formatReady || (draft && !draftKey)) return;
    const controller = new AbortController();
    const key = mode + "|" + draftKey;
    const timer = setTimeout(async () => {
      setProblem(null);
      try {
        const response = await fetch("/api/presupuesto/pdf", {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
          body: JSON.stringify({ budgetId, mode, ...(draftKey ? { format: JSON.parse(draftKey) } : {}) }),
        });
        if (!response.ok) { const result = await response.json().catch(() => ({})) as { error?: string }; throw new Error(result.error ?? "No se pudo generar el PDF."); }
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = url; setPdfUrl(url); setEditable(response.headers.get("X-Format-Editable") !== "0"); setRenderedKey(key);
      } catch (error) {
        if (controller.signal.aborted) return;
        setProblem(error instanceof Error ? error.message : "No se pudo generar el PDF.");
      }
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [budgetId, mode, formatReady, draftKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  /** Descarga exactamente el PDF que se está viendo. */
  const downloadPdf = () => {
    if (!pdfUrl || !actions.canDownload) return;
    const link = document.createElement("a");
    link.href = pdfUrl; link.download = `${budget.isAlternative ? "Alternativa-de-tratamiento" : "Presupuesto-de-tratamiento"}-${budget.id}.pdf`;
    document.body.appendChild(link); link.click(); link.remove();
    setNotice({ kind: "ok", text: "PDF descargado. Revisa tus descargas." });
  };
  /**
   * Imprime exactamente el PDF que se está viendo. Safari y los teléfonos no imprimen un PDF incrustado (salen hojas en blanco
   * sin avisar), así que ahí se abre el PDF en otra pestaña para imprimirlo con el visor del sistema.
   */
  const canPrint = actions.canDownload && loadedUrl === pdfUrl;
  const printPdf = () => {
    if (!pdfUrl || !canPrint) return;
    const ua = navigator.userAgent;
    const embeddedPrintWorks = !/iPhone|iPad|iPod|Android|Mobile/i.test(ua) && !(/Safari/i.test(ua) && !/Chrome|Chromium|Edg|CriOS|FxiOS/i.test(ua));
    try {
      const frame = frameRef.current?.contentWindow;
      if (!embeddedPrintWorks || !frame) throw new Error("abrir aparte");
      frame.focus(); frame.print();
    } catch {
      const tab = window.open(pdfUrl, "_blank");
      setNotice(tab ? { kind: "ok", text: "Abrí el PDF en otra pestaña: imprímelo desde ahí (botón compartir o imprimir)." } : { kind: "error", text: "El navegador bloqueó la ventana. Usa «Abrir el PDF en una pestaña nueva» e imprime desde ahí." });
    }
  };
  const saveFormat = async () => {
    if (!draftFormat || loadFailed) return;
    setBusy("save"); setNotice(null);
    try {
      const response = await fetch("/api/presupuesto/formato", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "guardar", format: draftFormat }) });
      const result = await response.json().catch(() => ({})) as { format?: BudgetFormat; error?: string };
      if (!response.ok || !result.format) throw new Error(result.error ?? "No se pudo guardar el diseño.");
      setSaved(result.format); setDraft(result.format);
      setNotice({ kind: "ok", text: "Diseño guardado. Tus próximos presupuestos saldrán así." });
    } catch (error) { setNotice({ kind: "error", text: error instanceof Error ? error.message : "No se pudo guardar el diseño." }); }
    finally { setBusy(""); }
  };
  const prepareSend = async () => {
    if (!actions.canSend) return;
    const token = requestToken.current;
    setBusy("preview"); setNotice(null);
    try {
      const response = await fetch(`/api/presupuesto/enviar?budgetId=${budget.id}`);
      const result = await response.json().catch(() => ({})) as { preview?: { to: string; from: string }; error?: string };
      if (!response.ok || !result.preview) setNotice({ kind: "error", text: result.error ?? "No se pudo preparar el correo." });
      else if (token === requestToken.current) setTarget({ to: result.preview.to, from: result.preview.from }); // si cambió el modo o el diseño mientras tanto, se descarta
    } catch { setNotice({ kind: "error", text: "Sin conexión. Intenta de nuevo." }); }
    finally { setBusy(""); }
  };
  const sendNow = async () => {
    if (!actions.canSend) return;
    setBusy("send"); setNotice(null);
    try {
      const response = await fetch("/api/presupuesto/enviar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ budgetId: budget.id, mode }) });
      const result = await response.json().catch(() => ({})) as { to?: string; error?: string };
      if (!response.ok) setNotice({ kind: "error", text: result.error ?? "No se pudo enviar el correo." });
      else { setNotice({ kind: "ok", text: `PDF enviado a ${result.to}.` }); setTarget(null); }
    } catch { setNotice({ kind: "error", text: "Sin conexión. No se envió; intenta de nuevo." }); }
    finally { setBusy(""); }
  };
  const blockSend = canEdit && dirty;

  return <>
      <DialogHeader>
        <DialogTitle>Previsualizar presupuesto</DialogTitle>
        <DialogDescription>Esto es el PDF tal como lo recibirá {patientName || "el paciente"}. Cambia aquí el diseño y la vista se actualiza; puedes imprimirlo, descargarlo o enviarlo al correo registrado.</DialogDescription>
      </DialogHeader>
      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-label="Vista previa del PDF" className="min-w-0">
          <div className="relative h-[70vh] min-h-[420px] overflow-hidden rounded-xl border border-[#dddbe6] bg-[#f1f0f5]" data-testid="budget-pdf-preview">
            {pdfUrl && <iframe ref={frameRef} onLoad={() => setLoadedUrl(pdfUrl)} title="Vista previa del presupuesto en PDF" src={pdfUrl} className="size-full bg-white"/>}
            {(rendering || (!pdfUrl && !problem && !formatError)) && <p role="status" className="absolute left-3 top-3 rounded-lg bg-white/90 px-3 py-1.5 text-xs text-[#4f4e62] shadow">Armando el PDF…</p>}
            {formatError && !problem && <p role="status" className="absolute inset-x-3 top-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">La vista no se actualiza hasta que corrijas el diseño: {formatError}</p>}
            {problem && <p role="alert" className="absolute inset-x-3 top-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">{problem}</p>}
          </div>
          {pdfUrl && <a href={pdfUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-[#473a6d] underline"><ExternalLink className="size-3"/>Abrir el PDF en una pestaña nueva</a>}
        </section>

        <aside className="min-w-0 space-y-4" aria-label="Opciones del presupuesto">
          <div role="radiogroup" aria-label="Formato del presupuesto" className="grid gap-2">
            {modes.map(option => <button key={option.value} type="button" role="radio" aria-checked={mode === option.value} disabled={allUndefined && option.value !== "no-prices"} onClick={() => chooseMode(option.value)}
              className={"rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50 " + (mode === option.value ? "border-[#473a6d] bg-[#efeef4]" : "border-[#dddbe6] bg-white hover:border-[#b8b1d6]")}>
              <span className="block font-semibold">{option.title}</span>
              <span className="mt-1 block text-xs text-[#615f73]">{option.description}</span>
            </button>)}
          </div>
          {canEdit && draft ? <details className="rounded-xl border border-[#dddbe6] bg-white p-3" open data-testid="budget-design-editor">
            <summary className="cursor-pointer text-sm font-semibold text-[#35343f]">Diseño del PDF (colores, firma, condiciones)</summary>
            <div className="mt-4">
              <fieldset disabled={busy === "save"} className="min-w-0 border-0 p-0"><BudgetFormatEditor format={draft} onChange={changeDraft} logo={logo} profileClinic={profileClinic}/></fieldset>
              {formatError && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{formatError}</p>}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" disabled={busy !== "" || !dirty || Boolean(formatError)} onClick={() => void saveFormat()} className="bg-[#473a6d] text-white hover:bg-[#3a2f5a]"><Save className="mr-2 size-4"/>{busy === "save" ? "Guardando…" : "Guardar como mi diseño"}</Button>
                <span className="text-xs text-[#6b6a7c]">{dirty ? "Cambios sin guardar: se ven aquí y en la descarga, pero el correo usa el diseño guardado." : "Es tu diseño guardado."}</span>
              </div>
            </div>
          </details> : <p className="rounded-xl border border-[#dddbe6] bg-[#f7f6fa] p-3 text-xs text-[#615f73]">
            {loadFailed ? "No se pudo cargar tu diseño guardado; el PDF sale con el diseño guardado. Recarga la página para editarlo." : editable === null ? "Cargando tu diseño…" : "Este presupuesto lo armó otro profesional del equipo, así que sale con su diseño. Cada uno ajusta el suyo desde sus propios presupuestos."}
          </p>}
        </aside>
      </div>

      <div className="space-y-3">
        {target && <div role="region" aria-label="Confirmar envío" className="rounded-xl border border-[#b8b1d6] bg-[#f7f6fa] p-3 text-sm">
          <p>Se enviará el PDF a <strong>{target.to}</strong> desde <strong>{target.from}</strong>.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" size="sm" className="bg-[#473a6d] hover:bg-[#3a2f5a]" disabled={busy !== "" || !actions.canSend} onClick={() => void sendNow()}>{busy === "send" ? "Enviando…" : "Enviar ahora"}</Button>
            <Button type="button" size="sm" variant="outline" disabled={busy === "send"} onClick={() => setTarget(null)}>Cancelar</Button>
          </div>
        </div>}
        {(blockSend || formatError) && <p role="status" className="rounded-lg bg-[#f7f6fa] p-3 text-sm text-[#4f4e62]">Para enviar el PDF con estos cambios, primero guarda el diseño: así el paciente recibe exactamente lo que ves.</p>}
        {notice && <p role={notice.kind === "error" ? "alert" : "status"} className={"rounded-lg p-3 text-sm " + (notice.kind === "error" ? "bg-amber-50 text-amber-950" : "bg-emerald-50 text-emerald-900")}>{notice.text}</p>}
        <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button type="button" variant="outline" onClick={onClose}>Cerrar</Button>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" variant="outline" disabled={busy !== "" || !actions.canSend} onClick={() => void prepareSend()}><Mail className="mr-2 size-4"/>{busy === "preview" ? "Preparando…" : "Enviar al correo del paciente"}</Button>
            <Button type="button" variant="outline" disabled={busy !== "" || !canPrint} onClick={printPdf} data-testid="budget-print"><Printer className="mr-2 size-4"/>Imprimir</Button>
            <Button type="button" className="bg-[#473a6d] hover:bg-[#3a2f5a]" disabled={busy !== "" || !actions.canDownload} onClick={downloadPdf}><Download className="mr-2 size-4"/>Descargar PDF</Button>
          </div>
        </DialogFooter>
      </div>
  </>;
}
