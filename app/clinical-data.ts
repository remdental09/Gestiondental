import type { CariesDepth } from "@/lib/caries";
export const PERIO_SITES = [
  { key: "MV", label: "Mesial" },
  { key: "V", label: "Central" },
  { key: "DV", label: "Distal" },
  { key: "ML", label: "Mesial" },
  { key: "L", label: "Central" },
  { key: "DL", label: "Distal" },
] as const;

/** Formats the stored two-digit FDI code (e.g. 12) as quadrant.position (1.2). */
export const formatFdi = (tooth: number): string => `${Math.floor(tooth / 10)}.${tooth % 10}`;

export const GINGIVAL_INDEX_SITES = [
  { key: "V", label: "Vestibular" },
  { key: "L", label: "Lingual / palatino" },
  { key: "D", label: "Distal" },
  { key: "M", label: "Mesial" },
] as const;

export const EPB_SEXTANTS = [
  { key: "1", label: "Superior derecho", range: "1.8–1.4" },
  { key: "2", label: "Superior anterior", range: "1.3–2.3" },
  { key: "3", label: "Superior izquierdo", range: "2.4–2.8" },
  { key: "4", label: "Inferior derecho", range: "4.8–4.4" },
  { key: "5", label: "Inferior anterior", range: "4.3–3.3" },
  { key: "6", label: "Inferior izquierdo", range: "3.4–3.8" },
] as const;

export type PerioSiteKey = (typeof PERIO_SITES)[number]["key"];
export type PerioReading = { depth: number | null; margin: number | null; bleeding: boolean; suppuration: boolean };
export type GingivalIndexSiteKey = (typeof GINGIVAL_INDEX_SITES)[number]["key"];
export type GingivalIndexScore = 0 | 1 | 2 | 3;
export type PerioTooth = { sites: Partial<Record<PerioSiteKey, PerioReading>>; gingivalIndex?: Partial<Record<GingivalIndexSiteKey, GingivalIndexScore>>; mobility: string; furcation: string };
export type EPBCode = "0" | "1" | "2" | "3" | "4" | "*";
export type PerioExam = {
  id: number;
  recordedAt: string;
  teeth: Record<number, PerioTooth>;
  epb?: Partial<Record<(typeof EPB_SEXTANTS)[number]["key"], EPBCode>>;
  classification?: { system: "AAP-EFP 2017"; stage?: "I" | "II" | "III" | "IV"; grade?: "A" | "B" | "C"; extent?: "localized" | "generalized" | "molar-incisor" };
};

export type OdontogramSurface = "V" | "P" | "M" | "D" | "O";
export type RestorationMaterial = "Resina compuesta" | "Vidrio ionómero" | "Amalgama" | "Cavit" | "IRM" | "Otro";
export type SurfaceFinding = {
  condition: "not_examined" | "sound" | "caries" | "restored" | "sealant" | "other_restoration";
  /** Profundidad de la caries (esmalte, dentina superficial, dentina profunda, compromiso pulpar). Opcional. */
  depth?: CariesDepth | null;
  /** Registros anteriores: ICDAS 1–6. Se conservan y se muestran como registro anterior; ya no se piden. */
  icdas?: 1 | 2 | 3 | 4 | 5 | 6 | null;
  activity?: "active" | "inactive" | "uncertain" | null;
  /** Tipo y material de restauración, solo cuando se dictaron expresamente. */
  restorationStage?: "provisional" | "definitive" | null;
  restorationMaterial?: RestorationMaterial | null;
};
export type CrownDetails = {
  material: string;
  shade?: string | null;
  source?: "evolution" | "manual";
  clinicalDate?: string;
  /** tooth: corona sobre diente natural. implant: prótesis fija sobre implante. Ausente en fichas antiguas: diente natural. */
  foundation?: "tooth" | "implant";
};
export type ToothHistorySnapshot = {
  status: string;
  surfaces: Partial<Record<OdontogramSurface, SurfaceFinding>>;
  missingReason: "caries" | "other" | "unknown" | null;
  crown: CrownDetails | null;
};
export type ToothHistoryEvent = {
  id: string;
  tooth: number;
  recordedAt: string;
  clinicalDate?: string;
  eventType: "status" | "surface" | "crown" | "missing_reason" | "evolution" | "diagnosis";
  source?: "manual" | "evolution";
  sourceEvolutionId?: number;
  /** Clave idempotente de la acción clínica que originó este hito. */
  sourceActionId?: string;
  surface?: OdontogramSurface;
  title?: string;
  detail?: string;
  before?: ToothHistorySnapshot | null;
  after?: ToothHistorySnapshot | null;
};
export type OdontogramData = {
  teeth: Record<number, string>;
  surfaces: Record<number, Partial<Record<OdontogramSurface, SurfaceFinding>>>;
  missingReason: Record<number, "caries" | "other" | "unknown">;
  crowns?: Record<number, CrownDetails>;
  /** Historial append-only de cambios del odontograma, cuando está disponible. */
  history?: ToothHistoryEvent[];
};

export const emptyOdontogram = (): OdontogramData => ({ teeth: {}, surfaces: {}, missingReason: {}, crowns: {}, history: [] });
export type ClinicalImage = {
  id: number;
  patientId: number;
  url: string;
  name: string;
  kind: "Radiografía" | "Captura CBCT";
  note: string;
  addedAt: string;
  size: number;
  contentType: string;
};

export function summarizePerio(exam?: PerioExam) {
  let measured = 0, bleeding = 0, attention = 0, deep = 0, gingivalScore = 0, gingivalSites = 0;
  const affected = new Set<number>();
  if (exam) for (const [tooth, values] of Object.entries(exam.teeth)) {
    for (const score of Object.values(values.gingivalIndex ?? {})) {
      if (score === 0 || score === 1 || score === 2 || score === 3) { gingivalScore += score; gingivalSites++; }
    }
    for (const site of Object.values(values.sites)) {
      if (!site || site.depth === null) continue;
      measured++;
      if (site.bleeding) bleeding++;
      if (site.depth >= 6) deep++;
      if (site.depth >= 6 || (site.depth >= 4 && site.bleeding) || site.suppuration) {
        attention++;
        affected.add(Number(tooth));
      }
    }
  }
  const gingivalAverage = gingivalSites ? gingivalScore / gingivalSites : null;
  const gingivalSeverity = gingivalAverage === null ? null : gingivalAverage === 0 ? "Sin signos" : gingivalAverage <= 1 ? "Leve" : gingivalAverage <= 2 ? "Moderada" : "Severa";
  return { measured, bleeding, bleedingPercent: measured ? Math.round(bleeding / measured * 100) : null, attention, deep, affected: [...affected].sort((a,b)=>a-b), gingivalSites, gingivalAverage, gingivalSeverity };
}
