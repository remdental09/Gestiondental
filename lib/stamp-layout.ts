/**
 * Posición y tamaño del timbre del profesional. Se miden desde el lugar de siempre (bajo la firma y los datos del profesional),
 * así valen igual en pantalla y en el PDF, sea cual sea el largo del documento: dx (cm, + a la derecha), dy (cm, + hacia abajo)
 * y scale (1 = 5 × 2,5 cm). Además, opacity (1 = tinta plena) y knockout (quitar el fondo de la foto y dejar solo la tinta).
 * Sin diseño guardado, el timbre queda exactamente como antes.
 */
export type StampLayout = { dx: number; dy: number; scale: number; opacity: number; knockout: boolean };

export const DEFAULT_STAMP_LAYOUT: StampLayout = { dx: 0, dy: 0, scale: 1, opacity: 1, knockout: false };
export const STAMP_LIMITS = { dx: [-12, 12], dy: [-24, 4], scale: [0.5, 2], opacity: [0.3, 1] } as const;

const clamp = (value: number, [min, max]: readonly [number, number]) => Math.min(max, Math.max(min, value));
const round1 = (value: number) => Math.round(value * 10) / 10;
const num = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;

export function normalizeStampLayout(value: unknown): StampLayout {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    dx: round1(clamp(num(raw.dx, 0), STAMP_LIMITS.dx)),
    dy: round1(clamp(num(raw.dy, 0), STAMP_LIMITS.dy)),
    scale: Math.round(clamp(num(raw.scale, 1), STAMP_LIMITS.scale) * 100) / 100,
    opacity: Math.round(clamp(num(raw.opacity, 1), STAMP_LIMITS.opacity) * 100) / 100,
    knockout: raw.knockout === true,
  };
}

/** Texto guardado en la base: vacío = sin diseño propio (posición de siempre). */
export function parseStampLayout(text: string | null | undefined): StampLayout | null {
  if (!text) return null;
  try { return normalizeStampLayout(JSON.parse(text)); } catch { return null; }
}

export const isDefaultStampLayout = (layout: StampLayout | null | undefined) => !layout || (layout.dx === 0 && layout.dy === 0 && layout.scale === 1 && layout.opacity === 1 && !layout.knockout);
/** ¿Se movió de su lugar? Si es así ya no reserva espacio bajo la firma. */
export const isStampMoved = (layout: StampLayout | null | undefined) => !!layout && (layout.dx !== 0 || layout.dy !== 0);
export const serializeStampLayout = (layout: StampLayout) => isDefaultStampLayout(normalizeStampLayout(layout)) ? "" : JSON.stringify(normalizeStampLayout(layout));
/** Opacidad lista para el PDF (1 = plena). */
export const stampOpacity = (layout: StampLayout | null | undefined) => layout ? normalizeStampLayout(layout).opacity : 1;

export type Box = { x: number; y: number; width: number; height: number };

/**
 * Dónde dibujar el timbre en el PDF (puntos, origen abajo a la izquierda).
 * `slot`: caja de siempre (ancho/alto del timbre sin escalar) con su esquina inferior izquierda en (x, y).
 * El timbre se escala desde el centro del lugar de siempre, se mueve dx/dy y nunca sale de la hoja.
 */
export function placeStamp(image: { width: number; height: number }, slot: Box, layout: StampLayout | null | undefined, page: { width: number; height: number }, cmToPt: (cm: number) => number): Box {
  const l = layout ? normalizeStampLayout(layout) : DEFAULT_STAMP_LAYOUT;
  const boxW = slot.width * l.scale, boxH = slot.height * l.scale;
  const fit = Math.min(boxW / image.width, boxH / image.height);
  const width = image.width * fit, height = image.height * fit;
  // Se mantiene arriba-centro del lugar de siempre (el timbre cuelga bajo la firma), como en la versión sin diseño.
  const centerX = slot.x + slot.width / 2, top = slot.y + slot.height;
  const x = centerX - width / 2 + cmToPt(l.dx), y = top - height - cmToPt(l.dy);
  return { x: Math.min(Math.max(x, 0), Math.max(0, page.width - width)), y: Math.min(Math.max(y, 0), Math.max(0, page.height - height)), width, height };
}

/**
 * Estilo CSS para la vista en pantalla (mismo cálculo que el PDF, en cm).
 * `flow`: caja en su lugar de siempre (ocupa espacio bajo la firma). `float`: caja flotante, centrada bajo la firma y desplazada dx/dy.
 */
export function stampCssBox(layout: StampLayout | null | undefined, base: { width: number; height: number }) {
  const l = layout ? normalizeStampLayout(layout) : DEFAULT_STAMP_LAYOUT;
  const width = base.width * l.scale, height = base.height * l.scale;
  return {
    flow: { width: `${width}cm`, height: `${height}cm`, opacity: l.opacity },
    float: { width: `${width}cm`, height: `${height}cm`, left: `calc(50% + ${l.dx - width / 2}cm)`, top: `calc(0.375rem + ${l.dy}cm)`, opacity: l.opacity },
  };
}
