/**
 * Registro clínico chileno de la nota. El profesional dicta de forma coloquial; la nota debe quedar en lenguaje
 * odontológico correcto y solo con palabras que existen en la práctica de este país. Aquí viven:
 *  - los términos que no se usan en Chile y su forma correcta (se corrigen en la nota, salvo que el profesional los haya dictado);
 *  - las verbalizaciones coloquiales y su forma clínica, que se entregan a la IA como guía de redacción.
 * Ninguna verbalización agrega hechos: solo cambia la palabra por la forma formal de lo mismo.
 */

type NotUsed = { pattern: RegExp; use: string; plural?: string; said: string };

// Términos que la IA puede escribir pero que no son del uso chileno. «tartrectomía» es una forma de España.
const NOT_USED: NotUsed[] = [
  { pattern: /(?<!\p{L})tartrectom[ií]a(s?)(?!\p{L})/giu, use: "destartraje", plural: "destartrajes", said: "tartrectomia" },
];

const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const keepCase = (original: string, replacement: string) => /^\p{Lu}/u.test(original) ? replacement.charAt(0).toUpperCase() + replacement.slice(1) : replacement;

/**
 * Corrige en la nota los términos que no se usan en Chile. Si el profesional mismo dictó el término, se respeta tal cual
 * (el profesional manda sobre el diccionario). Devuelve el texto y las palabras que cambió.
 */
export function applyClinicalRegister(note: string, dictated: string): { text: string; replaced: { from: string; to: string }[] } {
  const said = fold(dictated);
  const replaced: { from: string; to: string }[] = [];
  let text = note;
  for (const rule of NOT_USED) {
    if (said.includes(rule.said)) continue;
    text = text.replace(rule.pattern, (match: string, s: string) => {
      const to = keepCase(match, s && rule.plural ? rule.plural : rule.use);
      replaced.push({ from: match, to });
      return to;
    });
  }
  return { text, replaced };
}

/** Verbalizaciones coloquiales → forma clínica. Solo equivalencias seguras: nunca agregan un hecho que no se dictó. */
const VERBALIZATIONS: Array<[string, string]> = [
  ["sacar/limpiar/picar la caries", "remoción de tejido cariado"],
  ["tapadura, tapar, arreglo, relleno, empaste, calza", "restauración (obturación)"],
  ["sacar la muela / el diente, extraer", "exodoncia de la pieza"],
  ["muela del juicio", "tercer molar (cordal)"],
  ["muela / diente de leche", "pieza temporal"],
  ["limpieza (sin más detalle)", "limpieza dental"],
  ["sarro", "cálculo dental"],
  ["pulir / dejar liso", "pulido (de la restauración, si se trata de una)"],
  ["ajustar / bajar la mordida", "ajuste oclusal"],
  ["sacar el molde / la impresión", "toma de impresión"],
  ["sacar / tomar una placa o una radiografía", "toma de radiografía"],
  ["poner flúor / barniz", "aplicación de flúor"],
  ["poner sellante", "sellante de fosas y fisuras"],
  ["pegar / poner la corona (si se dictó cementación)", "cementar la corona"],
  ["se sangra la encía", "sangrado gingival"],
  ["ponerle anestesia, anestesiar", "se administra anestesia"],
  ["dejar sellado / tapado provisoriamente", "obturación provisoria"],
];

export const CLINICAL_REGISTER_PROMPT = `Registro clínico de esta consulta (Chile):
- El profesional habla de forma coloquial; tú escribes como un especialista en odontología: voz formal, términos precisos y solo palabras que existen en odontología. Nunca inventes ni derives palabras (no «tartrectomía», que es de España: en Chile se escribe «destartraje» o «profilaxis» según lo dictado). Si dudas de que una palabra exista, usa la forma descriptiva simple.
- Interpreta el lenguaje humano por su sentido clínico, con comprensión: una frase informal se traduce a su forma clínica sin cambiar ni agregar hechos. No todo se dicta con exactitud; no exijas precisión que el profesional no dio ni conviertas su duda en un dato.
- Verbalizaciones coloquiales → forma clínica: ${VERBALIZATIONS.map(([said, clinical]) => `«${said}» → «${clinical}»`).join("; ")}.
- Una palabra técnica que el profesional dictó se conserva tal cual (el profesional manda sobre estas equivalencias).`;
