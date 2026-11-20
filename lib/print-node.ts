/**
 * Imprime solo un nodo (el documento), en hoja Carta: lo copia a #gd-print-root al final del <body> y marca
 * <html class="gd-print-node">; el CSS de impresión oculta (display:none) todo lo demás, así no quedan páginas en
 * blanco con el resto de la app (antes se ocultaba con visibility y la app seguía ocupando 6–7 páginas).
 * Se limpia después de imprimir (afterprint, o al volver el foco en iPhone).
 */
export const PRINT_ROOT_ID = "gd-print-root";
export const PRINT_CLASS = "gd-print-node";

let cleanupCurrent: (() => void) | null = null;

/** Prepara la copia para imprimir (también sirve para Cmd+P / Compartir → Imprimir vía «beforeprint»). */
export function mountPrintCopy(node: HTMLElement | null): () => void {
  cleanupCurrent?.();
  if (!node || typeof document === "undefined") return () => undefined;
  const root = document.createElement("div");
  root.id = PRINT_ROOT_ID;
  const copy = node.cloneNode(true) as HTMLElement;
  copy.removeAttribute("id");
  copy.setAttribute("data-print-copy", "");
  root.appendChild(copy);
  document.body.appendChild(root);
  document.documentElement.classList.add(PRINT_CLASS);
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    document.documentElement.classList.remove(PRINT_CLASS);
    root.remove();
    window.removeEventListener("afterprint", cleanup);
    if (cleanupCurrent === cleanup) cleanupCurrent = null;
  };
  window.addEventListener("afterprint", cleanup);
  cleanupCurrent = cleanup;
  return cleanup;
}

export function printNode(node: HTMLElement | null): void {
  if (!node) { window.print(); return; }
  const cleanup = mountPrintCopy(node);
  // Safari en iPhone a veces no emite afterprint: se limpia al volver a la página.
  window.addEventListener("focus", () => window.setTimeout(cleanup, 800), { once: true });
  window.requestAnimationFrame(() => window.print());
}
