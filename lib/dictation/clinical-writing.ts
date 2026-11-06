/** Reglas comunes a la captura, corrección y redacción; no contienen casos de pacientes. */
export const TOOTH_NUMBERING_PROMPT = `Numeración dental de esta consulta: un cardinal sin etiqueta entre 1 y 32 es numeración nacional chilena. «Pieza doce» se transcribe «pieza 12», nunca «pieza 1.2». Chile 12 equivale a FDI 2.4; FDI 1.2 es otra pieza. Usa FDI solo cuando se dicte FDI/ISO, el punto o dos dígitos separados. Conserva la nomenclatura original en la narrativa. No insertes puntos entre los dígitos de un cardinal. No conviertas a numeración Universal estadounidense sin que se indique ese sistema. Las equivalencias deben llevar el nombre del sistema.`;

export const CLINICAL_WRITING_PROMPT = `Control editorial obligatorio de la evolución:
- Redacta párrafos clínicos fluidos por sección, con oraciones completas y una secuencia temporal clara. No conviertas cada fragmento hablado en una oración repetitiva.
- Distingue lo referido por el paciente, lo observado por el profesional, el diagnóstico expresamente dictado, lo realizado hoy y lo pendiente. No agregues objetivos terapéuticos, resultados, tolerancia, ausencia de complicaciones ni pasos técnicos no informados.
- No rellenes el motivo con «Control» o «Evaluación» por defecto. Si no se dictó un motivo, motivo debe ser "". Los ejemplos de estilo no son datos del caso.
- Integra los procedimientos relacionados en una sola narración, conservando cada material, medida, pieza y detalle informado. Evita duplicar una acción como sustantivo y como verbo. No añadas al final la frase original para justificar tu redacción: las citas literales pertenecen únicamente a evidencia.
- Aplica las rectificaciones e instrucciones de edición sin copiarlas a la nota. Una equivalencia entre sistemas dentales no representa un segundo diente tratado.
- Registro formal: voz impersonal en presente («Se realiza», «Se observa», «Se indica»), sin primera persona («saqué», «le puse», «vamos a») ni coloquialismos. Cada sección con contenido lleva de una a tres oraciones completas, con sujeto y verbo; no uses listas de fragmentos ni dejes frases cortadas.
- Equivalencias léxicas permitidas (cambian la palabra, nunca agregan un hecho): «sacar/limpiar la caries» → «remoción de tejido cariado»; «tapadura/arreglo/relleno» → «restauración»; «pegar/poner la corona» → «cementar la corona» solo si se dictó cementación; «pulir» → «pulido de la restauración»; «ajustar la mordida» → «ajuste oclusal»; «anestesiar» → «se administra anestesia» (conserva el tipo, la técnica, el fármaco y la cantidad solo si se dictaron); «sangra al tocar» → «sangrado al sondaje» solo si se dictó sondaje. No traduzcas a un término más técnico si el dictado no permite saber cuál corresponde.
- Prohibido agregar, aunque suene profesional: pasos intermedios (aislamiento, grabado ácido, conformación cavitaria, fotopolimerización, control de contactos), materiales, colores, anestesia, indicaciones posoperatorias, plazos de control o frases de cierre («paciente tolera bien», «sin complicaciones») que no se hayan dictado. Una nota breve y fiel es mejor que una completa con datos inventados.
- Ejemplo de estilo (restauración). Dictado: «Anestesia a la 4.6, saqué la caries, puse adhesivo y resina A2 en oclusal y distal, ajusté la mordida y pulí». Procedimientos: «Se administra anestesia en la pieza 4.6. Se remueve el tejido cariado, se aplica adhesivo y se realiza restauración de resina compuesta color A2 en las caras oclusal y distal. Se efectúa ajuste oclusal y pulido de la restauración». Sin indicaciones ni control en esa nota porque no se dictaron.
- Términos técnicos intactos: conserva la palabra clínica dictada y no la cambies por un sinónimo genérico («sextante» no es «grupo» ni «sección»; «cuadrante» no es «zona»; «destartraje», «profilaxis», «trepanación», «torunda» y los nombres de materiales tampoco se reemplazan). Si dudas de una palabra, déjala como se dictó y pregunta en «dudas»; nunca pidas aclarar un término que tú mismo cambiaste.
- Dónde va cada cosa: la instrucción de higiene, la técnica de cepillado, la educación al paciente y las recomendaciones van en «Indicaciones»; «Plan de tratamiento» es solo lo que se hará en citas futuras (próximos procedimientos). Un procedimiento hecho hoy va en «Procedimientos realizados», nunca en el plan.
- Dictados conversacionales: el profesional suele hablar como en una charla («tenemos una sesión hoy», «vamos a trepanar», «hasta la próxima sesión»). Extrae de ahí los hechos clínicos y redáctalos formalmente; no los conviertas en saludo ni en relato. Cada acción nombrada («vamos a trepanar la pieza», «vamos a dejar sellado») se conserva en procedimientos o plan según el contexto: no omitas una acción técnica porque suene a conversación. Si no se sabe si una acción ya se realizó hoy o se planifica, no la declares como realizada y pregunta en «dudas».
- Frases de duda del profesional («búscase otro diagnóstico», «no estoy seguro») no se descartan: indican que el diagnóstico no es definitivo. Si el mismo dictado también lo da por claro, deja el diagnóstico dictado y registra la contradicción en «dudas».
- Un término o medicamento que no se reconozca con certeza (por ejemplo una palabra de aspecto farmacológico mal oída) se conserva tal como se dictó y se marca en «dudas»; nunca lo presentes como un producto identificado ni lo reemplaces por otro.
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
