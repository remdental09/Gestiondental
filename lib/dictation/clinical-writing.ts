/** Reglas comunes a la captura, corrección y redacción; no contienen casos de pacientes. */
export const TOOTH_NUMBERING_PROMPT = `Numeración dental de esta consulta: un cardinal sin etiqueta entre 1 y 32 es numeración nacional chilena. «Pieza doce» se transcribe «pieza 12», nunca «pieza 1.2». Chile 12 equivale a FDI 2.4; FDI 1.2 es otra pieza. Usa FDI solo cuando se dicte FDI/ISO, el punto o dos dígitos separados. Conserva la nomenclatura original en la narrativa. No insertes puntos entre los dígitos de un cardinal. No conviertas a numeración Universal estadounidense sin que se indique ese sistema. Las equivalencias deben llevar el nombre del sistema.`;

export const CLINICAL_WRITING_PROMPT = `Control editorial obligatorio de la evolución:
- Redacta párrafos clínicos fluidos por sección, con oraciones completas y una secuencia temporal clara. No conviertas cada fragmento hablado en una oración repetitiva.
- Distingue lo referido por el paciente, lo observado por el profesional, el diagnóstico expresamente dictado, lo realizado hoy y lo pendiente. No agregues objetivos terapéuticos, resultados, tolerancia, ausencia de complicaciones ni pasos técnicos no informados.
- No rellenes el motivo con «Control» o «Evaluación» por defecto. Si no se dictó un motivo, motivo debe ser "". Los ejemplos de estilo no son datos del caso.
- Integra los procedimientos relacionados en una sola narración, conservando cada material, medida, pieza y detalle informado. Evita duplicar una acción como sustantivo y como verbo. No añadas al final la frase original para justificar tu redacción: las citas literales pertenecen únicamente a evidencia.
- Aplica las rectificaciones e instrucciones de edición sin copiarlas a la nota. Una equivalencia entre sistemas dentales no representa un segundo diente tratado.
- Comprueba antes de responder: cada hecho aparece una vez, no hay hechos inventados, los números mantienen su sistema, lo planificado no aparece como realizado y ninguna sección vacía tiene contenido de relleno.`;

const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const STOP = new Set("se realiza realizo efectua efectuo hace el la los las en con y e de del por para un una al".split(" "));

/** Comparación conservadora y direccional: todos los detalles del origen deben estar presentes. */
export function procedureCovered(source: string, candidate: string): boolean {
  const terms = (value: string) => fold(value)
    .replace(/\b(?:confecciona|confecciono|confeccion)\b/g, "confeccion")
    .replace(/\b(?:provisoria|provisorio|provisional)\b/g, "provisional")
    .replace(/\b(?:destartraje|detartraje) supra(?: gingival)? y sub(?: gingival)?\b/g, "destartraje supragingival y subgingival")
    .replace(/\bsupra gingival\b/g, "supragingival")
    .replace(/\bsub gingival\b/g, "subgingival")
    .match(/\d+(?:[.,]\d+)?|[a-z]+/g)?.filter((term) => !STOP.has(term)) ?? [];
  const left = terms(source);
  const right = terms(candidate);
  // No confundir procedimientos negados o planificados con actos realizados.
  const polarity = (tokens: string[]) => tokens.filter((t) => ["no", "sin", "pendiente", "planifica", "planifico"].includes(t)).join("|");
  if (polarity(left) !== polarity(right)) return false;
  return left.length > 0 && left.every((term) => right.includes(term));
}

/** Solo elimina oraciones ya contenidas; conserva las que aportan nuevos detalles. */
export function deduplicateProcedureSentences(text: string): string {
  const lines = text.trim().split(/\n+|(?<=[.!?])\s+/).filter(Boolean);
  return lines.filter((line, index) => !lines.some((other, otherIndex) =>
    otherIndex !== index && procedureCovered(line, other)
    && (!procedureCovered(other, line) || otherIndex < index),
  )).join(" ");
}
