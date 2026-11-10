"use client";

/**
 * Punto desde donde «nace» una ventana: el último toque o clic (o, con teclado, el elemento enfocado).
 * La ventana se anima como un embudo desde ese punto y vuelve a él al cerrarse, al estilo de macOS.
 */
let last: { x: number; y: number; at: number } | null = null;
let listening = false;

function listen() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("pointerdown", (event) => { last = { x: event.clientX, y: event.clientY, at: Date.now() }; }, { capture: true, passive: true });
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const el = document.activeElement as HTMLElement | null;
    const rect = el?.getBoundingClientRect();
    if (rect && rect.width) last = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, at: Date.now() };
  }, { capture: true, passive: true });
}
listen();

/** Desplazamiento desde el centro de la pantalla hasta el origen. Sin origen reciente, la ventana crece desde el centro. */
export function windowOriginOffset(): { dx: number; dy: number } {
  listen();
  if (typeof window === "undefined") return { dx: 0, dy: 0 };
  let point = last && Date.now() - last.at < 4000 ? last : null;
  // Si el código de la ventana se cargó después del clic, el botón que la abrió aún tiene el foco.
  if (!point) {
    const el = document.activeElement as HTMLElement | null;
    const rect = el && el !== document.body ? el.getBoundingClientRect() : null;
    if (rect && rect.width) point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, at: Date.now() };
  }
  if (!point) return { dx: 0, dy: 0 };
  return { dx: Math.round(point.x - window.innerWidth / 2), dy: Math.round(point.y - window.innerHeight / 2) };
}
