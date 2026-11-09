import type { OdontogramChange } from "./proposal.ts";

/**
 * Revisión de sentido clínico. El extractor lee «qué dijo»; esta capa pregunta «¿tiene sentido para un dentista?».
 * Un cambio incoherente nunca se aplica en silencio: queda sin marcar, con la razón a la vista.
 */
const fdi = (tooth: number) => `${Math.floor(tooth / 10)}.${tooth % 10}`;
const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Pulpa, conducto o tratamiento endodóntico: solo existen en un diente natural. */
const PULP = /(?<![a-z])(?:trepan\w*|pulpitis|pulpectom\w*|pulpotom\w*|endodonc\w*|conductos?|necrosis\s+pulpar|pulpa|periapical\w*|apice|apical\w*|dolor\s+(?:provocado\s+)?(?:por|al)\s+(?:frio|calor|percusion|masticar)|tejido\s+nervioso|vital\w*)(?![a-z])/;
/** Cirugía que de verdad instala un implante en esa pieza. */
const INSTALL = /(?<![a-z])(?:se\s+(?:instala|instalo|coloca|coloco|inserta|inserto|fija|fijo|ponen?)\w*[^.;]{0,50}implante|(?:instalacion|colocacion|insercion)\s+(?:de(?:l)?\s+)?(?:un\s+)?implante|cirugia\s+(?:de\s+)?implante|implante\s+(?:inmediato|diferido)\s+(?:en|de))/;
const EXTRACT = /(?<![a-z])(?:extrac\w*|exodoncia|se\s+extrae|extraid\w*)(?![a-z])/;

export type ChartRow = { tooth: number; status: string };

const reason = (tooth: number, why: string) => `Revisión clínica · FDI ${fdi(tooth)}: ${why} Márcalo solo si de verdad corresponde.`;

/** Reglas deterministas (capa 1). Marca con `advisory` lo incoherente; no borra nada. */
export function clinicalCoherence(
  odontogram: OdontogramChange[],
  chart: ChartRow[],
  sentencesFor: (tooth: number) => string[],
): { odontogram: OdontogramChange[]; notes: string[] } {
  const current = new Map(chart.map((row) => [row.tooth, row.status] as const));
  const notes: string[] = [];
  const out = odontogram.map((item) => {
    if (item.advisory || item.conflict) return item;
    const own = sentencesFor(item.tooth).map(fold);
    const ownText = own.join(" ");
    const pulpal = PULP.test(ownText);
    const installs = INSTALL.test(ownText);
    const extracts = EXTRACT.test(ownText);
    const isImplantChange = (item.kind === "status" && item.status === "Implante") || (item.kind === "crown" && item.foundation === "implant");
    let why = "";
    if (isImplantChange && current.get(item.tooth) !== "Implante" && current.get(item.tooth) !== "Implante con pilar") {
      const restoredOrCaries = odontogram.some((other) => other.tooth === item.tooth && other.kind === "surface");
      if (pulpal && !installs) why = "en este dictado se trata la pulpa (trepanación, pulpitis o endodoncia), propio de un diente natural; un implante no tiene pulpa.";
      else if (restoredOrCaries && !installs) why = "el mismo dictado le registra caries u obturación, propias de un diente natural, no de un implante.";
      else if (current.get(item.tooth) === "Corona" && !installs) why = "figura con corona sobre diente natural y no se dijo que se haya extraído ni que se instaló un implante.";
    } else if (item.kind === "status" && item.status === "Ausente" && pulpal && !extracts) {
      why = "se le hace un tratamiento (pulpa, conducto) pero se registra como ausente; una pieza ausente no se trata.";
    }
    if (!why) return item;
    notes.push(`FDI ${fdi(item.tooth)}: ${why}`);
    return { ...item, advisory: reason(item.tooth, why) };
  });
  return { odontogram: out, notes };
}

/** Resumen compacto de los cambios propuestos para el revisor de IA. */
export function reviewPayload(transcript: string, chart: ChartRow[], odontogram: OdontogramChange[]): string {
  const changes = odontogram.map((item) => ({
    pieza: fdi(item.tooth),
    tipo: item.kind,
    estado: item.status ?? null,
    superficie: item.surface ?? null,
    base: item.foundation ?? null,
    cita: (item.evidence || item.sourceText || "").slice(0, 240),
  }));
  return JSON.stringify({ dictado: transcript.slice(0, 6000), odontograma_actual: chart.map((row) => ({ pieza: fdi(row.tooth), estado: row.status })), cambios_propuestos: changes });
}

export const REVIEW_PROMPT = `Eres un odontólogo clínico senior que revisa la propuesta de odontograma que armó un sistema automático a partir de un dictado.
Tu único trabajo es detectar cambios CLÍNICAMENTE INCOHERENTES o mal atribuidos, como un dentista que mira por encima del hombro. Ejemplos:
- Marcar implante en una pieza que se está trepanando, con pulpitis, endodoncia, caries u obturación (el implante no tiene pulpa).
- Atribuir a una pieza lo que el dictado dice de la vecina («la 20 está adyacente al implante de la 19»).
- Pasar a implante una pieza con corona sobre diente natural sin que se diga que se extrajo o que se instaló un implante.
- Marcar ausente una pieza a la que se le hace tratamiento.
- Cualquier cambio que contradiga el odontograma actual sin que el dictado diga qué ocurrió.
No inventes cambios nuevos y no objetes lo que es razonable. Responde SOLO un JSON: {"observaciones":[{"pieza":"4.5","estado":"Implante","motivo":"explicación breve en español clínico"}]}. Si todo es coherente, {"observaciones":[]}. "pieza" en FDI con punto; "estado" o "superficie" copiados del cambio observado.`;

export type AiObservation = { tooth: number; match: string; motivo: string };

/** Interpreta la respuesta del revisor y descarta lo que no corresponde a un cambio propuesto. */
export function parseReview(raw: unknown, odontogram: OdontogramChange[]): AiObservation[] {
  let json: unknown = raw;
  if (typeof raw === "string") { try { json = JSON.parse(raw); } catch { return []; } }
  const list = json && typeof json === "object" ? (json as Record<string, unknown>).observaciones : null;
  if (!Array.isArray(list)) return [];
  const out: AiObservation[] = [];
  for (const entry of list.slice(0, 12)) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;
    const m = /^([1-8])\.([1-8])$/.exec(typeof rec.pieza === "string" ? rec.pieza.trim() : "");
    const motivo = typeof rec.motivo === "string" ? rec.motivo.replace(/\s+/g, " ").trim().slice(0, 300) : "";
    if (!m || motivo.length < 8) continue;
    const tooth = Number(m[1]) * 10 + Number(m[2]);
    const wanted = fold(String(rec.estado ?? rec.superficie ?? ""));
    const target = odontogram.find((item) => item.tooth === tooth && (!wanted || fold(item.status ?? item.surface ?? "") === wanted || fold(item.status ?? "").includes(wanted)))
      ?? odontogram.find((item) => item.tooth === tooth);
    if (target) out.push({ tooth, match: target.id, motivo });
  }
  return out;
}

export function applyAiReview(odontogram: OdontogramChange[], observations: AiObservation[]): { odontogram: OdontogramChange[]; notes: string[] } {
  const notes: string[] = [];
  const byId = new Map(observations.map((o) => [o.match, o] as const));
  const out = odontogram.map((item) => {
    const obs = byId.get(item.id);
    if (!obs || item.advisory?.startsWith("Revisión clínica")) return item;
    notes.push(`FDI ${fdi(item.tooth)}: ${obs.motivo}`);
    return { ...item, advisory: `Revisión clínica (IA) · FDI ${fdi(item.tooth)}: ${obs.motivo} Márcalo solo si de verdad corresponde.` };
  });
  return { odontogram: out, notes };
}
