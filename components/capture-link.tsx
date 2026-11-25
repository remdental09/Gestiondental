"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, MonitorUp } from "lucide-react";
import { CAPTURE_REMEMBER_KEY, createCaptureLink, needsCut, patientCheck, viewerPatient, type CaptureState, type CaptureView } from "@/lib/capture-bridge";
import { cutViews } from "@/lib/capture-crop";

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
  /** «Capturar todo» sin marcas: la próxima imagen se reparte en las vistas que se encuentren. */
  const splitNext = useRef(false);
  const markedNow = useRef<CaptureView[] | null>(null);
  const closed = useRef(false);
  useEffect(() => { closed.current = false; const urls = previews.current; return () => { closed.current = true; urls.forEach(url => URL.revokeObjectURL(url)); urls.clear(); }; }, []);

  useEffect(() => {
    const created = createCaptureLink({
      save: async (file, capture) => {
        const now = handlers.current, as = capture.view ?? now.view, all = splitNext.current;
        const cut = needsCut({ viewer: capture.viewer, view: as, marked: markedNow.current, wholeWindow: now.wholeWindow, all });
        const cuts = cut ? await cutViews(file, all ? "all" : [as], viewerPatient(capture.title)) : [];
        const pieces: { view: CaptureView; file: File }[] = cuts.length ? cuts : [{ view: as, file }];
        const missing = !cut || cuts.length === (all ? 4 : 1) ? ""
          : !cuts.length ? `No encontré ${all ? "las vistas" : `«${as}»`} en Blue Sky: entró la ventana completa.`
          : `En Blue Sky solo encontré: ${cuts.map(item => item.view).join(", ")}.`;
        // El aviso es de una vista: se quita cuando esa misma vista llega sin problema.
        const message = missing || (capture.warning ? `«${as}»: ${capture.warning}` : "");
        const note = () => setWarning(previous => message || (previous.includes(`«${as}»`) || all ? "" : previous));
        if (patientCheck(capture.title, now.patientName) === "distinto") {
          const shown = viewerPatient(capture.title) ?? "otro paciente";
          const waiting = pieces.map(piece => {
            const url = URL.createObjectURL(piece.file);
            previews.current.add(url);
            return { id: `${capture.id}-${piece.view}`, file: piece.file, url, view: piece.view, shown };
          });
          setHeld(list => [...list, ...waiting]);
          splitNext.current = false;
          note();
          return "held";
        }
        let failed = false;
        for (const piece of pieces) {
          let result = await handlers.current.onCapture(piece.file, piece.view);
          // Con una sola imagen, la conexión reintenta; con varias se insiste aquí para no repetir las ya guardadas.
          for (let attempt = 0; result === "busy" && pieces.length > 1 && attempt < 60 && !closed.current; attempt++) {
            await new Promise(resolve => window.setTimeout(resolve, 500));
            result = await handlers.current.onCapture(piece.file, piece.view);
          }
          if (result === "busy" && pieces.length === 1) return "busy";
          if (result !== "saved") failed = true;
        }
        splitNext.current = false;
        if (!failed) note();
        return failed ? "failed" : "saved";
      },
      onProblem: message => handlers.current.onProblem(message),
      onState: next => { if (next.kind === "receiving") { remember(); markedNow.current = next.status.marked; } setState(next); },
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
    // Con vistas marcadas en la capturadora, ella manda una imagen por marca; sin marcas se reparte aquí.
    const byMarks = all && !!markedNow.current?.length;
    splitNext.current = all && !byMarks;
    try { if (!await link.current?.capture(byMarks)) splitNext.current = false; } finally { setAsking(false); }
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
  const blueSky = /^blue ?sky ?plan/i.test(viewer ?? "");
  return <div className="space-y-2 rounded-xl border border-[#e6e4ee] bg-white p-3" data-testid="implant-capture-link" data-state={state.kind}>
    {state.kind === "idle" && <>
      <button type="button" className={secondary} onClick={connect} data-testid="capture-connect"><MonitorUp className="size-4" aria-hidden="true"/>Conectar capturadora</button>
      <p className="text-xs text-[#615f73]">Para capturar tu visor directo a este implante. Abre antes la capturadora en este computador.</p>
    </>}
    {state.kind === "connecting" && <p role="status" className="flex items-center gap-2 text-sm text-[#473a6d]"><LoaderCircle className="size-4 animate-spin" aria-hidden="true"/>Conectando… si el navegador pide permiso, acéptalo.</p>}
    {state.kind === "receiving" && <>
      <p role="status" className={`text-sm font-semibold ${viewer ? "text-emerald-800" : "text-[#7a5a12]"}`}>{viewer ? `● Capturadora conectada · ${viewer}` : "○ Capturadora conectada · no ve un visor abierto"}</p>
      {check === "distinto" && <p className="break-words rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm font-semibold text-amber-900" data-testid="capture-mismatch">El visor muestra «{shown}» y esta ficha es de «{patientName}». Lo que captures no se guardará sin tu confirmación.</p>}
      {blueSky && <div className="flex flex-wrap gap-2" role="group" aria-label="Qué capturar">
        <button type="button" aria-pressed={!wholeWindow} className={frameChip(!wholeWindow)} onClick={() => setWholeWindow(false)}>Solo el corte</button>
        <button type="button" aria-pressed={wholeWindow} className={frameChip(wholeWindow)} onClick={() => setWholeWindow(true)}>Ventana completa</button>
      </div>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primary} disabled={!viewer || asking || busy} onClick={() => void capture()} data-testid="capture-now">{asking || busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true"/> : <MonitorUp className="size-4" aria-hidden="true"/>}Capturar «{view}»</button>
        {(blueSky || !!marked?.length) && <button type="button" className={secondary} disabled={!viewer || asking || busy} onClick={() => void capture(true)} data-testid="capture-all">Capturar todo</button>}
      </div>
      {blueSky && !wholeWindow && view !== "Radiografía" && !marked?.includes(view) && <p className="text-xs text-[#615f73]">SpeakDent busca «{view}» en Blue Sky y recorta solo ese corte{marked === null ? "" : ", con el nombre que muestra el visor"}.</p>}
      {marked === null && <p className="text-xs text-[#7a5a12]">Para que cada corte lleve el nombre del paciente, descarga abajo la versión 0.3 de la capturadora.</p>}
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
