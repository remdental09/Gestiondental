"use client";
/**
 * Lector de códigos en vivo: abre la cámara trasera y lee el QR, Data Matrix o código de barras de la etiqueta.
 * La imagen de la cámara no se guarda ni se envía: se analiza en el equipo.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, LoaderCircle, X } from "lucide-react";
import { isSquareCode, readCodes, warmCodeReader } from "@/lib/code-reader";
import type { CodeRead } from "@/lib/product-code";

export function CodeScanner({ onRead, onClose }: { onRead: (codes: CodeRead[]) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const done = useRef({ onRead, onClose, finished: false });
  /** Cerrado el lector, una lectura que termina tarde se ignora. */
  const open = useRef(true);
  useEffect(() => { open.current = true; return () => { open.current = false; }; }, []);
  useEffect(() => { done.current.onRead = onRead; done.current.onClose = onClose; });
  const [state, setState] = useState<"starting" | "scanning" | "blocked" | "photo">("starting");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let stopped = false, timer = 0, barsSince = 0, stream: MediaStream | null = null;
    done.current.finished = false;
    const canvas = document.createElement("canvas");
    const tick = async () => {
      if (stopped) return;
      const video = videoRef.current;
      if (video && video.readyState >= 2 && video.videoWidth) {
        // Se analiza el centro del cuadro (donde está la guía), a resolución completa: los Data Matrix son pequeños.
        const side = Math.round(Math.min(video.videoWidth, video.videoHeight) * 0.85);
        canvas.width = side; canvas.height = side;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (context) {
          context.drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, side, side);
          const codes = await readCodes(context.getImageData(0, 0, side, side)).catch(() => []);
          // Si primero aparece solo el código de barras, se espera un momento al cuadrado (trae lote y vencimiento).
          if (codes.length && !barsSince) barsSince = Date.now();
          if (!stopped && codes.length && !done.current.finished && (codes.some(code => isSquareCode(code.format)) || Date.now() - barsSince > 2000)) { done.current.finished = true; navigator.vibrate?.(60); done.current.onRead(codes); return; }
        }
      }
      timer = window.setTimeout(() => void tick(), 200);
    };
    (async () => {
      try {
        await warmCodeReader();
      } catch { if (!stopped) { setState("blocked"); setMessage("No se pudo cargar el lector. Revisa la conexión e inténtalo otra vez."); } return; }
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("sin cámara");
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
        if (stopped) { stream.getTracks().forEach(track => track.stop()); return; }
        const video = videoRef.current!;
        video.srcObject = stream; await video.play();
        setState("scanning"); void tick();
      } catch { if (!stopped) { setState("blocked"); setMessage("No se pudo abrir la cámara. Permite su uso, o toma una foto del código."); } }
    })();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); done.current.onClose(); } };
    document.addEventListener("keydown", onKey);
    return () => { stopped = true; window.clearTimeout(timer); stream?.getTracks().forEach(track => track.stop()); document.removeEventListener("keydown", onKey); };
  }, []);

  const photo = async (file?: File) => {
    if (!file) return;
    const before = state; setState("photo"); setMessage("");
    const codes = await readCodes(file).catch(() => []);
    if (!open.current || done.current.finished) return;
    if (codes.length) { done.current.finished = true; done.current.onRead(codes); return; }
    // En iPhone el video queda detenido al volver de la cámara de fotos.
    void videoRef.current?.play().catch(() => undefined);
    setState(before === "photo" ? "blocked" : before); setMessage("No se encontró un código en esa foto. Acércate, con buena luz y sin reflejos.");
  };

  // Va al <body>: también se abre desde la ventana de un implante y tiene que quedar por encima.
  return createPortal(<div role="dialog" aria-modal="true" aria-label="Lector de códigos" className="fixed inset-0 z-[95] flex flex-col bg-black text-white" data-testid="code-scanner">
    <div className="flex items-center justify-between gap-3 p-4"><strong>Escanear el código del producto</strong><button type="button" onClick={onClose} aria-label="Cerrar el lector" className="rounded-lg p-3 hover:bg-white/10"><X className="size-6"/></button></div>
    <div className="relative min-h-0 flex-1">
      <video ref={videoRef} playsInline muted autoPlay className="h-full w-full object-cover"/>
      {state === "scanning" && <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true"><span className="aspect-square w-[min(70vw,60vh)] rounded-3xl border-4 border-white/90 shadow-[0_0_0_100vmax_rgba(0,0,0,0.35)]"/></div>}
      {(state === "starting" || state === "photo") && <p role="status" className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60"><LoaderCircle className="size-6 animate-spin" aria-hidden="true"/>{state === "photo" ? "Buscando el código…" : "Abriendo la cámara…"}</p>}
    </div>
    <div className="space-y-3 p-4 text-center">
      <p role="status" className="text-sm">{message || "Pon el QR o el cuadrado de puntos (Data Matrix) dentro del marco."}</p>
      <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white px-4 font-semibold"><Camera className="size-5" aria-hidden="true"/>Tomar una foto del código</button>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={event => { void photo(event.target.files?.[0]); event.target.value = ""; }}/>
    </div>
  </div>, document.body);
}
