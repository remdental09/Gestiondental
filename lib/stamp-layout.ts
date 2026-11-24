/**
 * Posición y tamaño del timbre del profesional. Se miden desde el lugar de siempre (bajo la firma y los datos del profesional),
 * así valen igual en pantalla y en el PDF, sea cual sea el largo del documento: dx (cm, + a la derecha), dy (cm, + hacia abajo)
 * y scale (1 = 5 × 2,5 cm). Además, opacity (1 = tinta plena) y knockout (quitar el fondo de la foto y dejar solo la tinta).
 * La firma también se puede mover (sigDx, sigDy, sigScale: cm y escala desde su lugar de siempre) y, si el profesional lo pide, la firma y el
 * timbre se unen en una sola imagen (merged + mergedBox: dónde cae esa imagen, en cm, respecto del centro de la firma de siempre).
 * Sin diseño guardado, todo queda exactamente como antes.
 */
export type MergedBox = { x: number; y: number; w: number; h: number };
export type StampLayout = {
  dx: number; dy: number; scale: number; opacity: number; knockout: boolean; onSignature: boolean;
  sigDx: number; sigDy: number; sigScale: number;
  merged: boolean; mergedBox: MergedBox | null;
};
/** Lo que reciben los PDF y la pantalla: el diseño más la imagen unida (si existe), que se guarda aparte. */
export type PrintableStampLayout = StampLayout & { mergedMark?: string };

export const DEFAULT_STAMP_LAYOUT: StampLayout = { dx: 0, dy: 0, scale: 1, opacity: 1, knockout: false, onSignature: false, sigDx: 0, sigDy: 0, sigScale: 1, merged: false, mergedBox: null };
export const STAMP_LIMITS = { dx: [-12, 12], dy: [-24, 4], scale: [0.5, 2], opacity: [0.3, 1], sigDx: [-12, 12], sigDy: [-24, 6], sigScale: [0.5, 4] } as const;
/** Medidas del recuadro de la firma en cm (mismas que SIGNATURE_BOX_CM; se repiten aquí para que esta lógica no dependa de otro módulo). */
export const SIGNATURE_BASE_CM = { width: 6.5, height: 2.7 } as const;

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
    onSignature: raw.onSignature === true,
    sigDx: round1(clamp(num(raw.sigDx, 0), STAMP_LIMITS.sigDx)),
    sigDy: round1(clamp(num(raw.sigDy, 0), STAMP_LIMITS.sigDy)),
    sigScale: Math.round(clamp(num(raw.sigScale, 1), STAMP_LIMITS.sigScale) * 100) / 100,
    merged: raw.merged === true && normalizeMergedBox(raw.mergedBox) !== null,
    mergedBox: raw.merged === true ? normalizeMergedBox(raw.mergedBox) : null,
  };
}

function normalizeMergedBox(value: unknown): MergedBox | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const box = { x: num(raw.x, NaN), y: num(raw.y, NaN), w: num(raw.w, NaN), h: num(raw.h, NaN) };
  if (![box.x, box.y, box.w, box.h].every(Number.isFinite)) return null;
  if (box.w < 0.5 || box.h < 0.5 || box.w > 40 || box.h > 40 || Math.abs(box.x) > 40 || Math.abs(box.y) > 40) return null;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return { x: round2(box.x), y: round2(box.y), w: round2(box.w), h: round2(box.h) };
}

/** Texto guardado en la base: vacío = sin diseño propio (posición de siempre). */
export function parseStampLayout(text: string | null | undefined): StampLayout | null {
  if (!text) return null;
  try { return normalizeStampLayout(JSON.parse(text)); } catch { return null; }
}

export const isDefaultStampLayout = (layout: StampLayout | null | undefined) => !layout || (layout.dx === 0 && layout.dy === 0 && layout.scale === 1 && layout.opacity === 1 && !layout.knockout && !layout.onSignature && !isSignatureMoved(layout) && !layout.merged);
/** ¿Se movió o cambió de tamaño la firma? (sin esto se dibuja exactamente como siempre). */
export const isSignatureMoved = (layout: StampLayout | null | undefined) => !!layout && (layout.sigDx !== 0 || layout.sigDy !== 0 || layout.sigScale !== 1);
/** ¿Se movió de su lugar? Si es así ya no reserva espacio bajo la firma. */
export const isStampMoved = (layout: StampLayout | null | undefined) => !!layout && (layout.onSignature || layout.merged || layout.dx !== 0 || layout.dy !== 0);
export const serializeStampLayout = (layout: StampLayout) => isDefaultStampLayout(normalizeStampLayout(layout)) ? "" : JSON.stringify(normalizeStampLayout(layout));
/** Opacidad lista para el PDF (1 = plena). */
export const stampOpacity = (layout: StampLayout | null | undefined) => layout ? normalizeStampLayout(layout).opacity : 1;

export type Box = { x: number; y: number; width: number; height: number };

/**
 * Dónde dibujar el timbre en el PDF (puntos, origen abajo a la izquierda).
 * `slot`: caja de siempre (ancho/alto del timbre sin escalar) con su esquina inferior izquierda en (x, y).
 * El timbre se escala desde el centro del lugar de siempre, se mueve dx/dy y nunca sale de la hoja.
 */
export function placeStamp(image: { width: number; height: number }, slot: Box, layout: StampLayout | null | undefined, page: { width: number; height: number }, cmToPt: (cm: number) => number, signatureCenter?: { x: number; y: number } | null): Box {
  const l = layout ? normalizeStampLayout(layout) : DEFAULT_STAMP_LAYOUT;
  const boxW = slot.width * l.scale, boxH = slot.height * l.scale;
  const fit = Math.min(boxW / image.width, boxH / image.height);
  const width = image.width * fit, height = image.height * fit;
  const clampBox = (x: number, y: number): Box => ({ x: Math.min(Math.max(x, 0), Math.max(0, page.width - width)), y: Math.min(Math.max(y, 0), Math.max(0, page.height - height)), width, height });
  // «Sobre la firma»: el timbre se centra en la firma (dx/dy se miden desde ahí) y, si es de letras sueltas (sin fondo), la firma se ve debajo.
  if (l.onSignature && signatureCenter) return clampBox(signatureCenter.x - width / 2 + cmToPt(l.dx), signatureCenter.y - height / 2 - cmToPt(l.dy));
  // Se mantiene arriba-centro del lugar de siempre (el timbre cuelga bajo la firma), como en la versión sin diseño.
  const centerX = slot.x + slot.width / 2, top = slot.y + slot.height;
  const x = centerX - width / 2 + cmToPt(l.dx), y = top - height - cmToPt(l.dy);
  return clampBox(x, y);
}

/** Centro de la firma (puntos PDF) ya con su movimiento: el timbre «sobre la firma» la sigue. */
export function movedSignatureCenter(center: { x: number; y: number }, layout: StampLayout | null | undefined, cmToPt: (cm: number) => number): { x: number; y: number } {
  const l = layout ? normalizeStampLayout(layout) : DEFAULT_STAMP_LAYOUT;
  return { x: center.x + cmToPt(l.sigDx), y: center.y - cmToPt(l.sigDy) };
}

/** Dónde dibujar la firma movida o escalada (puntos PDF); sin movimiento devuelve null y se dibuja como siempre. */
export function placeSignature(image: { width: number; height: number }, box: { width: number; height: number }, center: { x: number; y: number }, layout: StampLayout | null | undefined, page: { width: number; height: number }, cmToPt: (cm: number) => number): Box | null {
  if (!layout || !isSignatureMoved(layout)) return null;
  const l = normalizeStampLayout(layout);
  const fit = Math.min((box.width * l.sigScale) / image.width, (box.height * l.sigScale) / image.height);
  const width = image.width * fit, height = image.height * fit, at = movedSignatureCenter(center, l, cmToPt);
  return { x: Math.min(Math.max(at.x - width / 2, 0), Math.max(0, page.width - width)), y: Math.min(Math.max(at.y - height / 2, 0), Math.max(0, page.height - height)), width, height };
}

/** Dónde dibujar la imagen firma+timbre unida (puntos PDF), medida desde el centro de la firma de siempre. */
export function placeMerged(box: MergedBox, center: { x: number; y: number }, page: { width: number; height: number }, cmToPt: (cm: number) => number): Box {
  const width = cmToPt(box.w), height = cmToPt(box.h);
  const x = center.x + cmToPt(box.x), y = center.y - cmToPt(box.y) - height;
  return { x: Math.min(Math.max(x, 0), Math.max(0, page.width - width)), y: Math.min(Math.max(y, 0), Math.max(0, page.height - height)), width, height };
}

/** Rectángulo (cm, origen = centro de la firma de siempre, y hacia abajo) que ocupa una imagen de relación de aspecto `aspect` dentro de una caja centrada en (cx, cy). */
export function fittedRectCm(aspect: number, boxW: number, boxH: number, cx: number, cy: number): MergedBox {
  const w = Math.min(boxW, boxH * aspect), h = w / aspect;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** Une dos rectángulos en el mínimo que contiene a ambos (el de la imagen firma+timbre). */
export function unionBox(a: MergedBox, b: MergedBox): MergedBox {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), right = Math.max(a.x + a.w, b.x + b.w), bottom = Math.max(a.y + a.h, b.y + b.h);
  return { x, y, w: right - x, h: bottom - y };
}

/** Alto aproximado (cm) entre el centro de la firma y el borde superior del lugar de siempre del timbre, para dibujar la miniatura del editor. */
export const SIGNATURE_CENTER_ABOVE_SLOT_CM = 2.8;

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
    // Dentro del recuadro de la firma, centrado en ella (modo «sobre la firma»).
    overSignature: { width: `${width}cm`, height: `${height}cm`, left: `calc(50% + ${l.sigDx + l.dx - width / 2}cm)`, top: `calc(50% + ${l.sigDy + l.dy - height / 2}cm)`, opacity: l.opacity },
    // Imagen firma+timbre unida, respecto del centro del recuadro de la firma.
    merged: l.mergedBox ? { width: `${l.mergedBox.w}cm`, height: `${l.mergedBox.h}cm`, left: `calc(50% + ${l.mergedBox.x}cm)`, top: `calc(50% + ${l.mergedBox.y}cm)` } : null,
    // Firma movida o escalada dentro de su recuadro.
    signature: { transform: `translate(${l.sigDx}cm, ${l.sigDy}cm) scale(${l.sigScale})`, transformOrigin: "center" },
  };
}
