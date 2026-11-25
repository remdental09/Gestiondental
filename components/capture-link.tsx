"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, MonitorUp } from "lucide-react";
import { CAPTURE_REMEMBER_KEY, createCaptureLink, type CaptureState } from "@/lib/capture-bridge";

type ViewState = CaptureState | { kind: "idle" } | { kind: "connecting" };

const remembered = () => { try { return window.localStorage.getItem(CAPTURE_REMEMBER_KEY) === "1"; } catch { return false; } };
const remember = () => { try { window.localStorage.setItem(CAPTURE_REMEMBER_KEY, "1"); } catch { /* se volverá a preguntar */ } };

const primary = "inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#473a6d] px-4 text-sm font-semibold text-white hover:bg-[#3a2f5a] disabled:opacity-50";
const secondary = "inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#c9c4da] bg-white px-4 text-sm font-semibold text-[#473a6d] hover:bg-[#f3f1f7] disabled:opacity-50";

/**
 * Capturadora de Windows conectada a la ficha de implante abierta. Se monta con una `key` por implante:
 * cada uno tiene su propia sesión, así una captura no puede terminar en otra ficha.
 */
export function CaptureLink({ target, view, busy, onCapture, onProblem }: {
  target: string;
  view: string;
  busy: boolean;
  onCapture: (file: File) => Promise<"saved" | "busy" | "failed">;
  onProblem: (message: string) => void;
}) {
  const [state, setState] = useState<ViewState>({ kind: "idle" });
  const [asking, setAsking] = useState(false);
  const [restored, setRestored] = useState(0);
  const link = useRef<ReturnType<typeof createCaptureLink> | null>(null);
  const handlers = useRef({ onCapture, onProblem });
  useEffect(() => { handlers.current = { onCapture, onProblem }; });

  useEffect(() => {
    const created = createCaptureLink({
      save: file => handlers.current.onCapture(file),
      onProblem: message => handlers.current.onProblem(message),
      onState: next => { if (next.kind === "receiving") remember(); setState(next); },
    });
    link.current = created;
    // Después de la primera conexión (con el permiso del navegador ya dado) se conecta sola.
    if (remembered()) void created.connect(); else setState({ kind: "idle" });
    const leave = () => created.stop();
    const back = (event: PageTransitionEvent) => { if (event.persisted) setRestored(value => value + 1); };
    window.addEventListener("pagehide", leave);
    window.addEventListener("pageshow", back);
    return () => { window.removeEventListener("pagehide", leave); window.removeEventListener("pageshow", back); created.stop(); link.current = null; };
  }, [restored]);

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
  const capture = async () => {
    if (asking) return;
    setAsking(true); onProblem("");
    try { await link.current?.capture(); } finally { setAsking(false); }
  };

  const viewer = state.kind === "receiving" ? state.status.viewer : null;
  return <div className="space-y-2 rounded-xl border border-[#e6e4ee] bg-white p-3" data-testid="implant-capture-link" data-state={state.kind}>
    {state.kind === "idle" && <>
      <button type="button" className={secondary} onClick={connect} data-testid="capture-connect"><MonitorUp className="size-4" aria-hidden="true"/>Conectar capturadora</button>
      <p className="text-xs text-[#615f73]">Para capturar tu visor directo a este implante. Abre antes la capturadora en este computador.</p>
    </>}
    {state.kind === "connecting" && <p role="status" className="flex items-center gap-2 text-sm text-[#473a6d]"><LoaderCircle className="size-4 animate-spin" aria-hidden="true"/>Conectando… si el navegador pide permiso, acéptalo.</p>}
    {state.kind === "receiving" && <>
      <p role="status" className={`text-sm font-semibold ${viewer ? "text-emerald-800" : "text-[#7a5a12]"}`}>{viewer ? `● Capturadora conectada · ${viewer}` : "○ Capturadora conectada · no ve un visor abierto"}</p>
      <button type="button" className={primary} disabled={!viewer || asking || busy} onClick={() => void capture()} data-testid="capture-now">{asking || busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true"/> : <MonitorUp className="size-4" aria-hidden="true"/>}{viewer ? `Capturar de ${viewer}` : "Capturar"}</button>
      <p className="text-xs text-[#615f73]">También con {state.status.hotkey ?? "F8"} dentro del visor. Entra como «{view}» al {target}: comprueba que el visor muestre a ese paciente.</p>
    </>}
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
