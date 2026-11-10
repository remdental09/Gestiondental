/** Dictado → endograma. La IA propone, aquí se valida todo contra el dictado y las listas clínicas; nada se guarda sin confirmación. */
import {
  CANAL_NAMES, CASE_TYPES, DIFFICULTY, IRRIGANTS, MEDICATIONS, OBTURATION_TECHNIQUES, PERIAPICAL_DX, PULPAL_DX, SEALERS, CORONAL_SEALS, SESSION_STEPS, TESTS,
  newCase, normalizeEndo, suggestedNextControl, type EndoCanal, type EndoCase, type EndoData, type TestKey,
} from "../endodontics.ts";
import { evidenceInTranscript, formatFdi, resolveAiTooth } from "./proposal.ts";

/** Palabras que justifican consultar a la IA por el endograma (evita gastar una llamada en cualquier dictado). */
export const ENDO_CUE = /(?<!\p{L})(?:endodoncia|conducto|conductometr\p{L}*|longitud\s+de\s+trabajo|pulpectom\p{L}*|pulpotom\p{L}*|biopulpectom\p{L}*|necropulpectom\p{L}*|retratamiento|gutapercha|cono\s+maestro|lima\s+maestra|localizador\s+apical|hipoclorito|apicectom\p{L}*|apexificaci\p{L}*|trepanaci\p{L}*)(?!\p{L})/iu;

export type EndoCanalProposal = { name: string; apparentLength?: number; apexLocator?: number; workingLength?: number; reference?: string; masterFile?: string; masterCone?: string };
export type EndoProposal = {
  id: string;
  tooth: number;
  numberingLabel: string;
  evidence: string;
  type?: string;
  complaint?: string;
  pain?: string;
  tests: Partial<Record<TestKey, string>>;
  pulpal?: string;
  periapical?: string;
  difficulty?: string;
  canals: EndoCanalProposal[];
  steps: string[];
  irrigants: string[];
  medication?: string;
  temporary?: string;
  obturation?: { technique?: string; sealer?: string; coronalSeal?: string };
};

export const ENDO_PROMPT = `Eres asistente de un dentista chileno. Del dictado clínico extrae SOLO lo que se dijo sobre tratamientos de conductos (endodoncia) y devuélvelo como JSON. No inventes, no infieras, no completes: si algo no se dijo, omítelo o déjalo vacío.
Responde {"endodoncias":[...]} con un elemento por pieza dentaria con endodoncia dictada. Cada elemento:
- "pieza": el número tal como se dijo; "sistema": "FDI" | "chilena" | "universal" | "" según se dijo; "evidencia": cita LITERAL y corta del dictado donde se nombra la pieza y el trabajo endodóntico.
- "tipo": uno de ${CASE_TYPES.join(" | ")} (o "").
- "motivo": molestia o motivo dicho; "dolor": características del dolor dichas.
- "pruebas": objeto con claves ${TESTS.map(t => `${t.key} (${t.options.join(" | ")})`).join("; ")}. Solo las pruebas que se dijeron, con exactamente una de las opciones.
- "diagnostico_pulpar": uno de ${PULPAL_DX.join(" | ")}; "diagnostico_periapical": uno de ${PERIAPICAL_DX.join(" | ")}. Solo si el clínico lo dijo explícitamente; nunca los deduzcas de los síntomas.
- "dificultad": ${DIFFICULTY.join(" | ")} solo si se dijo.
- "conductos": arreglo con {"nombre" (${CANAL_NAMES.join(", ")}), "longitud_aparente", "localizador", "longitud_trabajo" (mm, número), "referencia" (p. ej. cúspide vestibular, borde incisal), "lima_maestra" (p. ej. 40/.04), "cono_maestro"}. Un conducto por cada uno nombrado con sus medidas dictadas; los mm exactamente como se dijeron.
- "pasos": pasos realizados hoy, entre ${SESSION_STEPS.join(" | ")}; "irrigantes": entre ${IRRIGANTS.join(" | ")}; "medicacion": ${MEDICATIONS.join(" | ")}; "sellado_provisorio": texto.
- "obturacion": {"tecnica": ${OBTURATION_TECHNIQUES.join(" | ")}, "cemento": ${SEALERS.join(" | ")}, "sellado_coronario": ${CORONAL_SEALS.join(" | ")}} solo si se dijo.
Corrige únicamente errores evidentes de reconocimiento de voz en términos endodónticos (p. ej. «conductometría», «hipoclorito»). Si no hay endodoncia dictada, responde {"endodoncias":[]}.`;

const str = (value: unknown, max = 300) => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
const pick = (value: unknown, allowed: readonly string[]) => { const text = str(value, 120); return allowed.find(option => option.toLowerCase() === text.toLowerCase()) ?? ""; };
const mmOf = (value: unknown): number | undefined => {
  const n = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) && n > 0 && n <= 40 ? Math.round(n * 10) / 10 : undefined;
};
const list = (value: unknown, max: number): unknown[] => Array.isArray(value) ? value.slice(0, max) : [];
const obj = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Un mm solo se acepta si ese número aparece en lo dictado: la IA no puede inventar medidas. */
const numberSaid = (value: number | undefined, transcript: string) => {
  if (value === undefined) return undefined;
  const variants = [String(value), String(value).replace(".", ",")];
  return variants.some(variant => new RegExp(`(?<![\\d.,])${variant.replace(".", "[.,]")}(?![\\d])`).test(transcript)) ? value : undefined;
};

export function sanitizeEndoProposals(raw: unknown, transcript: string): { items: EndoProposal[]; rejected: string[] } {
  const rejected: string[] = [];
  const items: EndoProposal[] = [];
  const seen = new Set<number>();
  for (const entry of list(obj(raw).endodoncias, 12)) {
    const item = obj(entry);
    const evidence = str(item.evidencia, 400);
    if (!evidence || !evidenceInTranscript(evidence, transcript)) { rejected.push("Una endodoncia propuesta no tenía cita literal del dictado; no se anotó."); continue; }
    const mention = resolveAiTooth(str(item.pieza, 40), str(item.sistema, 20), evidence);
    if (!mention.ok) { rejected.push(mention.reason); continue; }
    if (seen.has(mention.tooth)) { rejected.push(`La pieza ${formatFdi(mention.tooth)} apareció dos veces; se conservó la primera.`); continue; }
    seen.add(mention.tooth);

    const testsIn = obj(item.pruebas);
    const tests: EndoProposal["tests"] = {};
    for (const test of TESTS) { const value = pick(testsIn[test.key], test.options); if (value) tests[test.key] = value; }

    const canals: EndoCanalProposal[] = [];
    for (const raw of list(item.conductos, 8)) {
      const c = obj(raw);
      const name = pick(c.nombre, CANAL_NAMES) || str(c.nombre, 30);
      const canal: EndoCanalProposal = {
        name,
        apparentLength: numberSaid(mmOf(c.longitud_aparente), transcript),
        apexLocator: numberSaid(mmOf(c.localizador), transcript),
        workingLength: numberSaid(mmOf(c.longitud_trabajo), transcript),
        reference: str(c.referencia, 60) || undefined,
        masterFile: str(c.lima_maestra, 20) || undefined,
        masterCone: str(c.cono_maestro, 20) || undefined,
      };
      if (canal.masterFile && !/^\d{2,3}(?:\/\.?\d{2})?$/.test(canal.masterFile)) canal.masterFile = undefined;
      if (canal.masterCone && !/^\d{2,3}(?:\/\.?\d{2})?$/.test(canal.masterCone)) canal.masterCone = undefined;
      // Un conducto solo se anota con alguna medida o instrumento dicho: así la IA no agrega conductos que nadie nombró con datos.
      if (canal.workingLength || canal.apparentLength || canal.apexLocator || canal.masterFile || canal.masterCone) canals.push(canal);
    }

    const obt = obj(item.obturacion);
    const obturation = { technique: pick(obt.tecnica, OBTURATION_TECHNIQUES) || undefined, sealer: pick(obt.cemento, SEALERS) || undefined, coronalSeal: pick(obt.sellado_coronario, CORONAL_SEALS) || undefined };
    const proposal: EndoProposal = {
      id: `endo${items.length + 1}`,
      tooth: mention.tooth,
      numberingLabel: mention.numberingLabel,
      evidence,
      type: pick(item.tipo, CASE_TYPES) || undefined,
      complaint: str(item.motivo, 400) || undefined,
      pain: str(item.dolor, 400) || undefined,
      tests,
      pulpal: pick(item.diagnostico_pulpar, PULPAL_DX) || undefined,
      periapical: pick(item.diagnostico_periapical, PERIAPICAL_DX) || undefined,
      difficulty: pick(item.dificultad, DIFFICULTY) || undefined,
      canals,
      steps: [...new Set(list(item.pasos, 20).map(step => pick(step, SESSION_STEPS)).filter(Boolean))],
      irrigants: [...new Set(list(item.irrigantes, 10).map(v => pick(v, IRRIGANTS)).filter(Boolean))],
      medication: pick(item.medicacion, MEDICATIONS) || undefined,
      temporary: str(item.sellado_provisorio, 120) || undefined,
      obturation: obturation.technique || obturation.sealer || obturation.coronalSeal ? obturation : undefined,
    };
    // Una obturación o conductometría dictada sin conductos ni pasos se anota igual: sirve para el aviso de documentación incompleta.
    const hasContent = Object.keys(tests).length || canals.length || proposal.steps.length || proposal.pulpal || proposal.periapical || proposal.type || proposal.obturation || proposal.complaint || proposal.irrigants.length || proposal.medication;
    if (!hasContent) { rejected.push(`Pieza ${formatFdi(mention.tooth)}: no hay datos endodónticos concretos que guardar.`); items.pop(); seen.delete(mention.tooth); continue; }
    items.push(proposal);
  }
  return { items, rejected };
}

const canalKey = (name: string) => fold(name).replace(/\s+/g, "");

/** Mezcla una propuesta aceptada en el endograma. Solo toca lo dictado; el resto del caso queda como estaba. */
export function applyEndoProposal(data: EndoData, p: EndoProposal, date: string, makeId: () => string): EndoData {
  const cases: EndoCase[] = JSON.parse(JSON.stringify(data.cases));
  // Se continúa el caso abierto de la pieza (sin cerrar ni obturar); si no hay, se abre uno nuevo.
  let target = [...cases].reverse().find(c => c.tooth === p.tooth && !c.closedReason && !c.obturation.date);
  if (!target) { target = newCase(makeId(), p.tooth, date); cases.push(target); }
  if (p.type) target.type = p.type;
  if (p.complaint) target.complaint = p.complaint;
  if (p.pain) target.pain = p.pain;
  for (const [key, value] of Object.entries(p.tests)) target.tests[key as TestKey] = value as string;
  if (p.pulpal) target.pulpal = p.pulpal;
  if (p.periapical) target.periapical = p.periapical;
  if (p.difficulty) target.difficulty = p.difficulty;
  for (const incoming of p.canals) {
    let canal: EndoCanal | undefined = target.canals.find(k => incoming.name && canalKey(k.name) === canalKey(incoming.name));
    if (!canal) {
      canal = { id: makeId(), name: incoming.name, apparentLength: 0, apexLocator: 0, workingLength: 0, reference: "", apexDistance: 0, masterFile: "", masterCone: "", notes: "" };
      target.canals.push(canal);
    }
    if (incoming.apparentLength) canal.apparentLength = incoming.apparentLength;
    if (incoming.apexLocator) canal.apexLocator = incoming.apexLocator;
    if (incoming.workingLength) canal.workingLength = incoming.workingLength;
    if (incoming.reference) canal.reference = incoming.reference;
    if (incoming.masterFile) canal.masterFile = incoming.masterFile;
    if (incoming.masterCone) canal.masterCone = incoming.masterCone;
  }
  const hasSession = p.steps.length || p.irrigants.length || (p.medication && p.medication !== "") || p.temporary;
  if (hasSession) {
    let session = target.sessions.find(s => s.date === date);
    if (!session) { session = { id: makeId(), date, steps: [], irrigants: [], medication: "", temporary: "", notes: "" }; target.sessions.push(session); }
    session.steps = [...new Set([...session.steps, ...p.steps])];
    session.irrigants = [...new Set([...session.irrigants, ...p.irrigants])];
    if (p.medication) session.medication = p.medication;
    if (p.temporary) session.temporary = p.temporary;
  }
  if (p.obturation) {
    if (p.obturation.technique) target.obturation.technique = p.obturation.technique;
    if (p.obturation.sealer) target.obturation.sealer = p.obturation.sealer;
    if (p.obturation.coronalSeal) target.obturation.coronalSeal = p.obturation.coronalSeal;
  }
  // La obturación queda fechada hoy solo si se dijo que se obturó (paso «Obturación»).
  if (p.steps.includes("Obturación") && !target.obturation.date) {
    target.obturation.date = date;
    if (!target.nextControlDate) target.nextControlDate = suggestedNextControl(date, 0);
  }
  return normalizeEndo({ version: 1, cases });
}

/** Líneas legibles de lo que se va a anotar, para que el clínico confirme sin tener que abrir el endograma. */
export function describeEndoProposal(p: EndoProposal): string[] {
  const lines: string[] = [];
  if (p.type) lines.push(`Tipo: ${p.type}`);
  if (p.complaint) lines.push(`Motivo: ${p.complaint}`);
  if (p.pain) lines.push(`Dolor: ${p.pain}`);
  const tests = TESTS.filter(t => p.tests[t.key]).map(t => `${t.label}: ${p.tests[t.key]}`);
  if (tests.length) lines.push(`Pruebas: ${tests.join("; ")}`);
  if (p.pulpal) lines.push(`Diagnóstico pulpar: ${p.pulpal}`);
  if (p.periapical) lines.push(`Diagnóstico periapical: ${p.periapical}`);
  for (const c of p.canals) {
    const parts = [c.workingLength && `LT ${String(c.workingLength).replace(".", ",")} mm`, c.apparentLength && `aparente ${String(c.apparentLength).replace(".", ",")} mm`, c.apexLocator && `localizador ${String(c.apexLocator).replace(".", ",")} mm`, c.reference && `ref. ${c.reference}`, c.masterFile && `lima ${c.masterFile}`, c.masterCone && `cono ${c.masterCone}`].filter(Boolean);
    lines.push(`Conducto ${c.name || "(sin nombre)"}${parts.length ? ": " + parts.join(", ") : ""}`);
  }
  if (p.steps.length) lines.push(`Hoy: ${p.steps.join(", ").toLowerCase()}`);
  if (p.irrigants.length) lines.push(`Irrigación: ${p.irrigants.join(", ")}`);
  if (p.medication && p.medication !== "Ninguna") lines.push(`Medicación intraconducto: ${p.medication}`);
  if (p.temporary) lines.push(`Sellado provisorio: ${p.temporary}`);
  if (p.obturation) lines.push(`Obturación: ${[p.obturation.technique, p.obturation.sealer && `cemento ${p.obturation.sealer}`, p.obturation.coronalSeal && `sellado ${p.obturation.coronalSeal}`].filter(Boolean).join(", ")}`);
  if (p.steps.includes("Obturación")) lines.push("Se fechará la obturación hoy y se sugerirá el control a los 6 meses.");
  return lines;
}
