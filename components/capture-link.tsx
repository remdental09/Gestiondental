"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, MonitorUp } from "lucide-react";
import { CAPTURE_REMEMBER_KEY, createCaptureLink, patientCheck, viewerPatient, type CaptureState, type CaptureView } from "@/lib/capture-bridge";

type ViewState = CaptureState | { kind: "idle" } | { kind: "connecting" };

const remembered = () => { try { return window.localStorage.getItem(CAPTURE_REMEMBER_KEY) === "1"; } catch { return false; } };
const remember = () => { try { window.localStorage.setItem(CAPTURE_REMEMBER_KEY, "1"); } catch { /* se volverá a preguntar */ } };

const primary = "inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#473a6d] px-4 text-sm font-semibold text-white hover:bg-[#3a2f5a] disabled:opacity-50";
const secondary = "inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#c9c4da] bg-white px-4 text-sm font-semibold text-[#473a6d] hover:bg-[#f3f1f7] disabled:opacity-50";
const frameChip = (on: boolean) => `min-h-11 rounded-full border px-3 text-sm ${on ? "border-[#473a6d] bg-[#473a6d] font-semibold text-white" : "border-[#c9c4da] bg-white text-[#473a6d]"}`;

/** Captura que no se guardó porque el visor mostraba otro nombre: queda solo en memoria hasta que se decida. */
type Held = { id: string; file: File; url: string; view: CaptureView; shown: string };

/**
 * Capturadora de Windows conectada a la ficha de implante abierta. Se monta con una `key` por implante:
 * cada uno tiene su propia sesión, así una captura no puede terminar en otra ficha.
 */
export function CaptureLink({ target, patientName, view, busy, onCapture, onProblem }: {
  target: string;
  patientName: string;
  view: CaptureView;
  busy: boolean;
  onCapture: (file: File, view: CaptureView) => Promise<"saved" | "busy" | "failed">;
  onProblem: (message: string) => void;
}) {
  const [state, setState] = useState<ViewState>({ kind: "idle" });
  const [asking, setAsking] = useState(false);
  const [restored, setRestored] = useState(0);
  const [wholeWindow, setWholeWindow] = useState(false);
  const [held, setHeld] = useState<Held[]>([]);
  const [warning, setWarning] = useState("");
  const link = useRef<ReturnType<typeof createCaptureLink> | null>(null);
  const handlers = useRef({ onCapture, onProblem, patientName, view, wholeWindow });
  useEffect(() => { handlers.current = { onCapture, onProblem, patientName, view, wholeWindow }; });
  /** Vistas previas de lo retenido: se liberan al decidir o al cerrar la ficha. */
  const previews = useRef(new Set<string>());
  useEffect(() => { const urls = previews.current; return () => { urls.forEach(url => URL.revokeObjectURL(url)); urls.clear(); }; }, []);

  useEffect(() => {
    const created = createCaptureLink({
      save: async (file, capture) => {
        const as = capture.view ?? handlers.current.view;
        // El aviso del programa es de una vista: se quita cuando esa misma vista llega sin problema.
        const note = () => setWarning(previous => capture.warning ? `«${as}»: ${capture.warning}` : previous.startsWith(`«${as}»:`) ? "" : previous);
        if (patientCheck(capture.title, handlers.current.patientName) === "distinto") {
          const url = URL.createObjectURL(file);
          previews.current.add(url);
          setHeld(list => [...list, { id: capture.id, file, url, view: as, shown: viewerPatient(capture.title) ?? "otro paciente" }]);
          note();
          return "held";
        }
        const result = await handlers.current.onCapture(file, as);
        if (result === "saved") note();
        return result;
      },
      onProblem: message => handlers.current.onProblem(message),
      onState: next => { if (next.kind === "receiving") remember(); setState(next); },
    });
    link.current = created;
    void created.choose({ view: handlers.current.view, wholeWindow: handlers.current.wholeWindow });
    // Después de la primera conexión (con el permiso del navegador ya dado) se conecta sola.
    if (remembered()) void created.connect(); else setState({ kind: "idle" });
    const leave = () => created.stop();
    const back = (event: PageTransitionEvent) => { if (event.persisted) setRestored(value => value + 1); };
    window.addEventListener("pagehide", leave);
    window.addEventListener("pageshow", back);
    return () => { window.removeEventListener("pagehide", leave); window.removeEventListener("pageshow", back); created.stop(); link.current = null; };
  }, [restored]);

  useEffect(() => { void link.current?.choose({ view, wholeWindow }); }, [view, wholeWindow]);

  // Si la capturadora estaba cerrada, se vuelve a buscar; al volver a esta pestaña, retoma el turno.
  useEffect(() => {
    if (state.kind === "missing" && remembered()) {
      const timer = window.setTimeout(() => void link.current?.connect(), 6_000);
      return () => window.clearTimeout(timer);
    }
    if (state.kind === "other") {
      const claim = () => void link.current?.connect();
      window.addEventListener("focus", claim);
      return () => window.removeEventListener("focus", claim);
    }
  }, [state]);

  const connect = () => { setState({ kind: "connecting" }); void link.current?.connect(); };
  const capture = async (all = false) => {
    if (asking) return;
    setAsking(true); onProblem(""); setWarning("");
    try { await link.current?.capture(all); } finally { setAsking(false); }
  };
  const forget = (item: Held) => {
    URL.revokeObjectURL(item.url); previews.current.delete(item.url);
    setHeld(list => list.filter(other => other.id !== item.id));
  };
  const keep = async (item: Held) => {
    if (await onCapture(item.file, item.view) === "saved") forget(item);
  };

  const viewer = state.kind === "receiving" ? state.status.viewer : null;
  const marked = state.kind === "receiving" ? state.status.marked : null;
  const check = state.kind === "receiving" && viewer ? patientCheck(state.status.title, patientName) : "sin-dato";
  const shown = state.kind === "receiving" ? viewerPatient(state.status.title) : null;
  return <div className="space-y-2 rounded-xl border border-[#e6e4ee] bg-white p-3" data-testid="implant-capture-link" data-state={state.kind}>
    {state.kind === "idle" && <>
      <button type="button" className={secondary} onClick={connect} data-testid="capture-connect"><MonitorUp className="size-4" aria-hidden="true"/>Conectar capturadora</button>
      <p className="text-xs text-[#615f73]">Para capturar tu visor directo a este implante. Abre antes la capturadora en este computador.</p>
    </>}
    {state.kind === "connecting" && <p role="status" className="flex items-center gap-2 text-sm text-[#473a6d]"><LoaderCircle className="size-4 animate-spin" aria-hidden="true"/>Conectando… si el navegador pide permiso, acéptalo.</p>}
    {state.kind === "receiving" && <>
      <p role="status" className={`text-sm font-semibold ${viewer ? "text-emerald-800" : "text-[#7a5a12]"}`}>{viewer ? `● Capturadora conectada · ${viewer}` : "○ Capturadora conectada · no ve un visor abierto"}</p>
      {check === "distinto" && <p className="break-words rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm font-semibold text-amber-900" data-testid="capture-mismatch">El visor muestra «{shown}» y esta ficha es de «{patientName}». Lo que captures no se guardará sin tu confirmación.</p>}
      {!!marked?.length && <div className="flex flex-wrap gap-2" role="group" aria-label="Qué capturar">
        <button type="button" aria-pressed={!wholeWindow} className={frameChip(!wholeWindow)} onClick={() => setWholeWindow(false)}>Solo el recuadro marcado</button>
        <button type="button" aria-pressed={wholeWindow} className={frameChip(wholeWindow)} onClick={() => setWholeWindow(true)}>Ventana completa</button>
      </div>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primary} disabled={!viewer || asking || busy} onClick={() => void capture()} data-testid="capture-now">{asking || busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true"/> : <MonitorUp className="size-4" aria-hidden="true"/>}Capturar «{view}»</button>
        {!!marked?.length && <button type="button" className={secondary} disabled={!viewer || asking || busy} onClick={() => void capture(true)} data-testid="capture-all">Capturar todo ({marked.length})</button>}
      </div>
      {marked === null && <p className="text-xs text-[#7a5a12]">Para capturar cada vista por separado, descarga abajo la versión 0.3 de la capturadora.</p>}
      {marked?.length === 0 && <p className="text-xs text-[#615f73]">Para recortar cada vista sola, márcalas una vez en la capturadora con «Marcar vistas».</p>}
      {!!marked?.length && !wholeWindow && view !== "Radiografía" && !marked.includes(view) && <p className="text-xs text-[#7a5a12]">«{view}» no está marcada en la capturadora: entrará la ventana completa.</p>}
      <p className="text-xs text-[#615f73]">También con {state.status.hotkey ?? "F8"} dentro del visor. Entra como «{view}» al {target}: {check === "coincide" ? "el nombre del visor coincide con la ficha." : `comprueba que el visor muestre a ${patientName}.`}</p>
    </>}
    {warning && <p role="status" className="text-sm text-[#7a5a12]">{warning}</p>}
    {held.length > 0 && <div role="alert" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900" data-testid="capture-held">
      <p className="break-words text-sm font-semibold">{held.length === 1 ? "Captura sin guardar" : `${held.length} capturas sin guardar`}: el visor mostraba un nombre distinto al de «{patientName}».</p>
      <ul className="space-y-2">{held.map(item => <li key={item.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-white p-2">
        <img src={item.url} alt={`Captura ${item.view} sin guardar`} className="h-20 w-28 rounded bg-[#1f1b30] object-contain"/>
        <p className="min-w-32 flex-1 break-words text-sm">{item.view} · en el visor: «{item.shown}»</p>
        <button type="button" className={secondary} disabled={busy} onClick={() => void keep(item)}>Guardar igual</button>
        <button type="button" className={secondary} onClick={() => forget(item)}>Descartar</button>
      </li>)}</ul>
      <p className="text-xs">Si descartas, el archivo sigue en la carpeta Imágenes\SpeakDent del computador.</p>
    </div>}
    {state.kind === "other" && <>
      <p role="status" className="text-sm text-[#7a5a12]">Las capturas están entrando a otra ficha abierta.</p>
      <button type="button" className={secondary} onClick={connect}>Recibir aquí</button>
    </>}
    {state.kind === "missing" && <>
      <p role="status" className="text-sm text-[#7a5a12]">No encuentro la capturadora. Ábrela en este computador (versión 0.2 o posterior) y, si el navegador pidió permiso, acéptalo.</p>
      <button type="button" className={secondary} onClick={connect}>Volver a intentar</button>
    </>}
  </div>;
}
