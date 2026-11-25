/**
 * Piezas y materiales anotados en cada fase de un implante. Puro (sin DOM ni base de datos).
 * La lista de tipos es abierta: en cualquier fase puede ir cualquier cosa; la app solo propone nombres y recuerda los nuevos.
 */
import type { ProductCategory } from "./biomedical-products.ts";

export const PIECE_KINDS = ["Implante", "Pilar", "Tornillo", "Cicatrizador", "Scan body", "Transfer", "Análogo", "Corona", "Material", "Injerto", "Membrana", "Sutura"] as const;

const plain = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toLowerCase();

/** Los tipos que se ofrecen: los comunes más los que esta cuenta ya escribió, sin repetir. */
export function pieceKindOptions(used: readonly string[] = []): string[] {
  const seen = new Set<string>();
  return [...PIECE_KINDS, ...used].filter(kind => { const key = plain(kind); if (!key || seen.has(key)) return false; seen.add(key); return true; });
}

/** Categoría de trazabilidad que corresponde a lo que el profesional dijo que es. */
export function kindCategory(kind: string): ProductCategory {
  const value = plain(kind);
  if (/^implante(s)?($| )/.test(value)) return "implante";
  if (/^(pilar|tornillo|cicatrizador|tapa|scan ?body|transfer|analogo|aditamento)/.test(value)) return "pilar";
  if (/^(injerto|biomaterial)/.test(value)) return "injerto";
  if (/^membrana/.test(value)) return "membrana";
  if (/^(sutura|hemostatico)/.test(value)) return "sutura";
  return "otro";
}

const CATEGORY_KIND: Record<string, string> = { implante: "Implante", pilar: "Pilar", injerto: "Injerto", membrana: "Membrana", sutura: "Sutura" };
export const categoryKind = (category: string) => CATEGORY_KIND[category] ?? "";

export type Piece = { id: number; implantId: number | null; stage: string; kind: string; category: string; tooth: string };
type Holder = { id: number; tooth: string; productId: number | null };

/** Nombre corto de la pieza; un producto registrado antes toma el de su categoría. */
export const pieceKind = (piece: Pick<Piece, "kind" | "category">) => piece.kind || categoryKind(piece.category) || "Otro";

/** Fase donde se ve la etiqueta de implante unida a la ficha antes de que las piezas tuvieran fase. */
export const LABEL_STAGE = "cirugia";

export function stagePieces<T extends Piece>(pieces: readonly T[], implant: Holder, phase: string): T[] {
  return pieces.filter(piece => (piece.implantId === implant.id && piece.stage === phase)
    || (phase === LABEL_STAGE && !piece.implantId && piece.id === implant.productId)).sort((a, b) => a.id - b.id);
}

/** Registros de esa pieza dental que no están en ninguna fase ni unidos a un implante. */
export function loosePieces<T extends Piece>(pieces: readonly T[], implant: Holder, implants: readonly Holder[]): T[] {
  const linked = new Set(implants.map(item => item.productId));
  // Lo que apunta a un implante que ya no existe también queda a la vista para ubicarlo.
  const existing = new Set(implants.map(item => item.id));
  return pieces.filter(piece => (!piece.implantId || !existing.has(piece.implantId)) && piece.tooth === implant.tooth && !linked.has(piece.id)).sort((a, b) => a.id - b.id);
}

/** «Implante · Pilar ×2 · Material». */
export function pieceSummary(pieces: readonly Pick<Piece, "kind" | "category">[]): string {
  const counts = new Map<string, number>();
  for (const piece of pieces) counts.set(pieceKind(piece), (counts.get(pieceKind(piece)) ?? 0) + 1);
  return [...counts].map(([kind, count]) => count > 1 ? `${kind} ×${count}` : kind).join(" · ");
}
