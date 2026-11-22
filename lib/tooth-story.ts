/**
 * «Película de la pieza»: la historia visual de un diente, etapa por etapa y con fecha
 * (por ejemplo: caries → obturación → lesión apical → corona → implante).
 *
 * Todo se deriva del historial que ya existe (cada hito guarda la pieza antes y después), así que nada se borra:
 * cada cambio que se registra agrega una etapa y la colección crece con el tiempo. Si se borra o anula una evolución,
 * sus etapas desaparecen solas (igual que el resto del historial). Las imágenes son las del banco de piezas
 * (referenciales, no son el paciente); si una situación no tiene imagen, la etapa igual aparece sin foto.
 * Lógica pura, sin red.
 */
import { applyEffect, eventDate } from "./odontogram-timeline.ts";
import { isLesionStatus } from "./tooth-status.ts";
import { toothPhotoFor, type CariesSpotInput, type RestorationInput, type ToothPhoto } from "./tooth-photos.ts";
import type { OdontogramSurface, ToothHistoryEvent, ToothHistorySnapshot } from "../app/clinical-data.ts";

const SURFACES: OdontogramSurface[] = ["O", "V", "P", "M", "D"];
const EMPTY: ToothHistorySnapshot = { status: "Sin hallazgos", surfaces: {}, missingReason: null, crown: null };
const clone = <T,>(value: T): T => (value == null ? value : JSON.parse(JSON.stringify(value)));
const isImplant = (status: string) => status === "Implante" || status === "Implante con pilar";
const chronological = (a: ToothHistoryEvent, b: ToothHistoryEvent) => eventDate(a).localeCompare(eventDate(b)) || a.recordedAt.localeCompare(b.recordedAt);

export type StoryStage = {
  id: string;
  /** AAAA-MM-DD */
  day: string;
  /** Qué pasó en esa etapa, corto («Obturación en Oclusal»). */
  label: string;
  /** Títulos de los hitos de ese día (dictado, evolución, cambio manual). */
  detail: string;
  snapshot: ToothHistorySnapshot;
  endoDone: boolean;
  /** Imagen del banco para ese estado; null si el banco no tiene una para esa situación. */
  photo: ToothPhoto | null;
  /** La pieza está ausente: la imagen es solo la silueta. */
  absent: boolean;
  /** Lesión (apical o fractura) vigente en esa etapa. */
  lesion: string | null;
  /** Evoluciones que originaron los cambios de ese día. */
  evolutionIds: number[];
  /** Primera etapa cuando la pieza ya traía algo registrado antes del primer hito. */
  initial: boolean;
  /** La etapa más reciente = el estado actual de la pieza. */
  current: boolean;
};

const faceName = (surface: OdontogramSurface, tooth: number) =>
  surface === "O" ? (tooth % 10 <= 3 ? "Incisal" : "Oclusal")
    : surface === "P" ? (Math.floor(tooth / 10) === 1 || Math.floor(tooth / 10) === 2 || Math.floor(tooth / 10) === 5 || Math.floor(tooth / 10) === 6 ? "Palatina" : "Lingual")
      : surface === "V" ? "Vestibular" : surface === "M" ? "Mesial" : "Distal";

const surfacesWith = (snap: ToothHistorySnapshot, test: (condition: string) => boolean) => SURFACES.filter(surface => test(snap.surfaces?.[surface]?.condition ?? ""));
const isRestored = (condition: string) => condition === "restored" || condition === "other_restoration";

/** Lo que cambia la imagen: si dos estados tienen la misma clave, se ven igual y no son una etapa nueva. */
export function visualKey(snap: ToothHistorySnapshot, endoDone: boolean): string {
  const faces = SURFACES.map(surface => {
    const f = snap.surfaces?.[surface];
    return f && f.condition !== "sound" && f.condition !== "not_examined" ? [surface, f.condition, f.depth ?? "", f.restorationMaterial ?? "", f.restorationStage ?? ""] : null;
  }).filter(Boolean);
  return JSON.stringify([snap.status, [...(snap.extras ?? [])].sort(), Boolean(snap.crown), faces, endoDone]);
}
const EMPTY_KEY = visualKey(EMPTY, false);

/** Texto corto de lo que cambió entre dos estados. */
export function describeChange(prev: ToothHistorySnapshot, prevEndo: boolean, cur: ToothHistorySnapshot, endo: boolean, tooth: number): string {
  const parts: string[] = [];
  const crowned = Boolean(cur.crown);
  if (cur.status !== prev.status) {
    if (cur.status === "Corona") parts.push("Corona colocada");
    else if (cur.status === "Implante") parts.push(crowned ? "Implante con corona" : "Implante");
    else if (cur.status === "Implante con pilar") parts.push("Implante con pilar");
    else if (cur.status === "Ausente") parts.push("Pieza ausente");
    else parts.push(cur.status);
  } else if (isImplant(cur.status) && crowned && !prev.crown) parts.push("Corona sobre implante");
  for (const extra of cur.extras ?? []) if (!(prev.extras ?? []).includes(extra)) parts.push(extra);
  const list = (surfaces: OdontogramSurface[]) => surfaces.map(surface => faceName(surface, tooth)).join(", ");
  const added = (test: (condition: string) => boolean) => surfacesWith(cur, test).filter(surface => !test(prev.surfaces?.[surface]?.condition ?? ""));
  const caries = added(condition => condition === "caries");
  const restored = added(isRestored);
  const sealed = added(condition => condition === "sealant");
  if (caries.length) parts.push(`Caries en ${list(caries)}`);
  if (restored.length) parts.push(`Obturación en ${list(restored)}`);
  if (sealed.length) parts.push(`Sellante en ${list(sealed)}`);
  if (endo && !prevEndo) parts.push("Endodoncia obturada");
  return parts.join(" · ") || "Cambio registrado";
}

/** La imagen del banco para un estado, con la misma lógica de la vista ampliada (corona, implante, endodoncia, caras). */
export function stagePhoto(tooth: number, snap: ToothHistorySnapshot, endoDone: boolean): { photo: ToothPhoto | null; absent: boolean; lesion: string | null } {
  const lesion = [snap.status, ...(snap.extras ?? [])].find(isLesionStatus) ?? null;
  if (snap.status === "Ausente") return { photo: toothPhotoFor({ fdi: tooth, status: "Sin hallazgos" }), absent: true, lesion };
  const implant = isImplant(snap.status);
  const hasCrown = snap.status === "Corona" || (implant && Boolean(snap.crown));
  const caries: CariesSpotInput[] = surfacesWith(snap, condition => condition === "caries").map(surface => ({ surface, depth: (snap.surfaces[surface]?.depth ?? null) as CariesSpotInput["depth"] }));
  const restoredSurfaces = surfacesWith(snap, isRestored);
  const restorations: RestorationInput[] = restoredSurfaces.map(surface => ({ surface, material: snap.surfaces[surface]?.restorationMaterial ?? null, stage: snap.surfaces[surface]?.restorationStage ?? null }));
  const sealedSurfaces = surfacesWith(snap, condition => condition === "sealant");
  // Con una lesión y sin corona ni implante, la etapa muestra la imagen de la lesión; con corona o implante se ve la corona/implante y la lesión va como texto.
  if (lesion && !hasCrown && !implant) return { photo: toothPhotoFor({ fdi: tooth, status: lesion, crown: false, implant: false, cariesSurfaces: caries }), absent: false, lesion };
  const baseStatus = isLesionStatus(snap.status) ? "Sin hallazgos" : snap.status;
  const photo = toothPhotoFor({
    fdi: tooth, status: baseStatus, implant, implantPhase: snap.status === "Implante con pilar" ? "pilar" : hasCrown ? "corona" : "sumergido",
    crown: hasCrown, endo: endoDone, caries: caries.length > 0, restored: restoredSurfaces.length > 0, cariesSurfaces: caries, restoredSurfaces, restorations, sealedSurfaces,
  });
  return { photo, absent: false, lesion };
}

/**
 * Las etapas de una pieza, de la más antigua a la más reciente.
 * `history` es el historial del odontograma más los hitos de evolución y endodoncia (como lo recibe la línea de tiempo).
 * `endoNow`: la pieza figura con endodoncia obturada hoy; si no hay fecha de obturación registrada, se muestra solo en la etapa actual.
 */
export function toothStory(history: ToothHistoryEvent[], tooth: number, options: { endoNow?: boolean } = {}): StoryStage[] {
  const own = history.filter(event => event.tooth === tooth);
  const changes = own.filter(event => event.after).sort(chronological);
  const obturations = own.filter(event => /^endo:.*:obturation$/.test(event.id)).map(eventDate).filter(Boolean).sort();
  const endoOn = obturations[0] ?? null;
  const days = [...new Set([...changes.map(eventDate), ...(endoOn ? [endoOn] : [])])].sort();
  if (!days.length) return [];

  let state: ToothHistorySnapshot = clone(changes.find(event => event.before)?.before ?? EMPTY);
  let endo = false;
  const stages: StoryStage[] = [];
  const make = (day: string, snap: ToothHistorySnapshot, endoDone: boolean, label: string, detail: string, evolutionIds: number[], initial: boolean): StoryStage => {
    const visual = stagePhoto(tooth, snap, endoDone);
    return { id: `${tooth}:${day}:${stages.length}`, day, label, detail, snapshot: clone(snap), endoDone, ...visual, evolutionIds, initial, current: false };
  };
  let prevKey = visualKey(state, false);
  if (prevKey !== EMPTY_KEY) stages.push(make(days[0], state, false, "Estado al primer registro", "", [], true));

  for (const day of days) {
    const dayEvents = changes.filter(event => eventDate(event) === day);
    const before = clone(state), beforeEndo = endo;
    for (const event of dayEvents) state = applyEffect(state, event);
    endo = Boolean(endoOn && day >= endoOn);
    const key = visualKey(state, endo);
    if (key === prevKey) continue;
    const titles = [...new Set(dayEvents.map(event => event.title?.trim()).filter((title): title is string => Boolean(title)))];
    const evolutionIds = [...new Set(dayEvents.map(event => event.sourceEvolutionId).filter((id): id is number => typeof id === "number"))];
    stages.push(make(day, state, endo, describeChange(before, beforeEndo, state, endo, tooth), titles.join(" · "), evolutionIds, false));
    prevKey = key;
  }

  // Endodoncia presente hoy pero sin fecha de obturación registrada: se muestra solo en la etapa actual.
  if (options.endoNow && !endoOn && stages.length && !stages[stages.length - 1].endoDone) {
    const last = stages[stages.length - 1];
    stages[stages.length - 1] = { ...last, endoDone: true, detail: [last.detail, "Endodoncia previa (fecha no registrada)"].filter(Boolean).join(" · "), ...stagePhoto(tooth, last.snapshot, true) };
  }
  if (stages.length) stages[stages.length - 1] = { ...stages[stages.length - 1], current: true };
  return stages;
}
