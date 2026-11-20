/** Lleva un elemento a la vista justo bajo la cabecera fija de la app (en iPhone la cabecera ocupa ~190 px y `scrollIntoView` lo dejaría tapado). */
export function scrollBelowHeader(element: Element | null, gap = 8): void {
  if (!element || typeof window === "undefined") return;
  const header = document.querySelector("header.sticky");
  const offset = header ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
  window.scrollTo({ top: Math.max(0, element.getBoundingClientRect().top + window.scrollY - offset - gap) });
}
