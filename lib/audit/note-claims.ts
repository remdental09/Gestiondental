import type { OdontogramData } from "../../app/clinical-data.ts";
import { chileToFdi, isValidFdi, universalToFdi } from "../dictation/proposal.ts";
import type { AuditFinding } from "./record-audit.ts";

/**
 * Auditoría posterior, capa 2: relectura ciega de la evolución guardada.
 * La IA solo EXTRAE lo que la nota afirma de cada pieza (con la cita literal); no ve el odontograma ni juzga.
 * Después el código compara esas afirmaciones con el odontograma de hoy. Así la IA no califica a la IA y, cuando el
 * profesional corrige el odontograma, la observación desaparece sola (la comparación se rehace en cada lectura).
 */
export type ClaimState = "corona" | "implante" | "ausente" | "obturacion" | "caries";
export type NoteClaim = { tooth: number; estado: ClaimState; cita: string };

export const CLAIM_PROMPT = `Eres un lector clínico para una ficha dental chilena. Lees UNA evolución ya guardada y extraes lo que afirma sobre cada pieza dentaria. No tienes el odontograma y no debes opinar: solo extraer.
Devuelve SOLO JSON: {"afirmaciones":[{"pieza":"7","sistema":"chilena|fdi|universal|no_dicho","estado":"corona|implante|ausente|obturacion|caries","momento":"hoy|constatado|referido|planificado","cita":"texto copiado literal de la nota"}]}
Reglas:
- Una afirmación por pieza: si la nota enumera «las piezas 7, 8, 9 y 10», devuelve cuatro, cada una con la misma cita.
- "pieza" es el número tal como aparece en la nota («7», «1.2», «36»). "sistema": «chilena» si la nota dice nacional/chilena, «fdi» si dice FDI o usa punto (1.2), «universal» si dice universal, «no_dicho» si es un número suelto.
- "estado": corona (corona o prótesis fija definitiva colocada), implante (implante instalado), ausente (pieza ausente o extraída), obturacion (obturación o restauración hecha o existente), caries (caries observada). Cualquier otra cosa (endodoncia, periodoncia, higiene, cirugía de tejidos, controles) NO se extrae.
- "momento": «hoy» si se hizo en esta atención; «constatado» si el profesional constata en el examen que ya existe; «referido» si lo cuenta el paciente o viene de antecedentes; «planificado» si se indica, planifica o propone para después.
- Las coronas provisorias no cuentan. Una duda («no existe claridad») no es una afirmación.
- "cita" debe ser un fragmento copiado tal cual de la nota (máx. 30 palabras) que incluya el número de la pieza y el tratamiento.
- No inventes piezas ni estados. Si no hay afirmaciones, devuelve {"afirmaciones":[]}.`;

const fold = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const fdi = (tooth: number) => `${Math.floor(tooth / 10)}.${tooth % 10}`;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const STATES = new Set<ClaimState>(["corona", "implante", "ausente", "obturacion", "caries"]);
const LABEL: Record<ClaimState, string> = { corona: "una corona", implante: "un implante", ausente: "la pieza ausente", obturacion: "una obturación", caries: "caries" };
/** Palabras que la cita debe contener para respaldar el estado (guarda contra afirmaciones inventadas). */
const WORDING: Record<ClaimState, RegExp> = {
  corona: /coron|protesis fija/, implante: /implant/, ausente: /ausen|extra[ie]d|extraj|exodonci|falta/,
  obturacion: /obtur|restaur|resina|amalgama|composite|ionomero|vidrio/, caries: /caries|cariad/,
};

function toothFrom(piece: string, system: string): number | null {
  const text = piece.trim().replace(",", ".");
  if (/^\d\.\d$/.test(text)) { const tooth = Number(text.replace(".", "")); return isValidFdi(tooth) ? tooth : null; }
  if (!/^\d{1,2}$/.test(text)) return null;
  const value = Number(text);
  if (system === "fdi") return isValidFdi(value) ? value : null;
  if (system === "universal") return universalToFdi(value);
  // «pieza 12» sin etiqueta se entiende como numeración nacional chilena en esta aplicación.
  return chileToFdi(value) ?? (system === "no_dicho" && isValidFdi(value) ? value : null);
}

/** Valida lo que devolvió la IA: cada afirmación debe estar respaldada por una cita literal de la nota. Lo demás se descarta. */
export function parseClaims(raw: string, body: string): NoteClaim[] {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  const list = (parsed as { afirmaciones?: unknown })?.afirmaciones;
  if (!Array.isArray(list)) return [];
  const haystack = fold(body);
  const seen = new Set<string>();
  const out: NoteClaim[] = [];
  for (const entry of list.slice(0, 40)) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const piece = typeof item.pieza === "string" || typeof item.pieza === "number" ? String(item.pieza) : "";
    const estado = item.estado as ClaimState;
    const cita = typeof item.cita === "string" ? item.cita.trim() : "";
    if (!STATES.has(estado) || (item.momento !== "hoy" && item.momento !== "constatado")) continue;
    const quote = fold(cita);
    if (quote.length < 8 || quote.length > 400 || !haystack.includes(quote)) continue;
    if (!WORDING[estado].test(quote) || (estado === "corona" && /provisori/.test(quote))) continue;
    const tooth = toothFrom(piece, typeof item.sistema === "string" ? item.sistema : "no_dicho");
    if (!tooth) continue;
    // La cita debe nombrar la pieza tal como se la leyó (7, 1.2…): una cita sin ese número no la respalda.
    const written = piece.trim(), dotted = /[.,]/.test(written);
    const pattern = new RegExp(`(?<![\\d.${dotted ? "," : ""}])${escape(written).replace(/[.,]|\\\./g, "[.,]")}(?!\\d)${dotted ? "" : "(?!\\.\\d)"}`);
    if (!pattern.test(quote)) continue;
    const key = `${tooth}|${estado}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ tooth, estado, cita: cita.slice(0, 300) });
  }
  return out;
}

const hasCrown = (chart: OdontogramData, tooth: number) => Boolean(chart.crowns?.[tooth]) || chart.teeth[tooth] === "Corona";
const facesOf = (chart: OdontogramData, tooth: number) => Object.values(chart.surfaces[tooth] ?? {});

/** ¿El odontograma NO refleja lo que la nota afirma? Ante la duda (pieza ya sin diente natural, con corona…) no avisa. */
export function chartLacks(chart: OdontogramData, claim: NoteClaim): boolean {
  const status = chart.teeth[claim.tooth] ?? "Sin hallazgos";
  const natural = !["Ausente", "Implante", "Implante con pilar"].includes(status);
  switch (claim.estado) {
    case "corona": return !hasCrown(chart, claim.tooth);
    case "implante": return !status.startsWith("Implante");
    case "ausente": return status !== "Ausente";
    case "obturacion": return natural && !hasCrown(chart, claim.tooth) && !facesOf(chart, claim.tooth).some((face) => face?.condition === "restored" || face?.condition === "other_restoration");
    case "caries": return natural && !hasCrown(chart, claim.tooth) && !facesOf(chart, claim.tooth).some((face) => face?.condition === "caries");
  }
}

export function findNoteMismatches(input: { patientId: number; noteId: number; clinicalDate: string; claims: NoteClaim[]; chart: OdontogramData }): AuditFinding[] {
  return input.claims.filter((claim) => chartLacks(input.chart, claim)).map((claim) => ({
    key: `nota-vs-odontograma|${input.patientId}|${input.noteId}|${claim.tooth}|${claim.estado}`,
    rule: "nota-vs-odontograma" as const, severity: "media" as const, patientId: input.patientId, tooth: claim.tooth, noteId: input.noteId,
    message: `La evolución del ${input.clinicalDate} dice «${claim.cita.length > 140 ? `${claim.cita.slice(0, 137)}…` : claim.cita}», pero el odontograma no registra ${LABEL[claim.estado]} en FDI ${fdi(claim.tooth)}.`,
    fix: "Agrégalo al odontograma si corresponde, o corrige la nota si estaba mal dicho.",
  }));
}

/** Texto que ve la IA: solo la nota (ciega al odontograma). */
export const claimPayload = (body: string) => `Evolución:\n${body.slice(0, 6000)}`;
