/**
 * Lo que el profesional describe de una pieza («la pieza vital, en buenas condiciones y sin dolor») es un hallazgo suyo.
 * La IA a veces lo parte entre «Anamnesis» y «Examen» y le antepone «Refiere», atribuyéndoselo al paciente. Aquí se comprueba
 * sin IA: la frase dictada queda entera en «Examen». Solo se reemplazan frases de la nota que no digan nada más que esa
 * observación; ante la duda no se cambia la nota y se avisa.
 */
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const splitSentences = (text: string) => text.split(/\n+|(?<=[.!?;])\s+/).map((part) => part.trim()).filter((part) => /[\p{L}\d]/u.test(part));

/** Observaciones que se reconocen. «Dolor» solo cuenta negado: el dolor que se afirma suele contarlo el paciente. */
const OBSERVATIONS: Array<[string, RegExp]> = [
  ["sin dolor", /\bsin (?:dolor|molestias?|sintomas|sintomatologia)\b/g],
  ["sin movilidad", /\bsin movilidad\b/g],
  ["buen estado", /\b(?:en )?(?:buenas condiciones|buen estado)\b/g],
  ["vital", /\bvital(?:es|idad)?\b/g],
  ["asintomatica", /\basintomatic[oa]s?\b/g],
];

/** Quién habla: con estas palabras el dato lo cuenta el paciente. */
const REPORT = /\b(?:refiere|refirio|referid[oa]|relata|comenta|manifiesta|manifesto|manifestad[oa]|dice|cuenta|senala que|siente|se queja|niega|reporta)\b/;

const words = (text: string) => new Set(text.split(" ").filter(Boolean));
const DICTATED_FILLER = words("la el una un pieza diente molar premolar incisivo canino muela dentaria dental se encuentra esta presenta y e con en del de fdi chilena nacional numero");
const NOTE_FILLER = new Set([...DICTATED_FILLER, ...words("al momento evaluacion examen actualmente observa que paciente refiere relata comenta manifiesta indica")]);
const TOOTH_WORD = /\b(?:pieza|diente|molar|premolar|incisivo|canino|muela|vital)\b/;

type Reading = { found: string[]; numbers: string[]; pure: boolean };

function read(sentence: string, filler: Set<string>): Reading {
  let rest = fold(sentence);
  const found: string[] = [];
  for (const [name, pattern] of OBSERVATIONS) {
    const next = rest.replace(pattern, " ");
    if (next !== rest) found.push(name);
    rest = next;
  }
  const numbers = fold(sentence).match(/\d+(?:\.\d+)?/g) ?? [];
  const leftovers = (rest.match(/[a-z]+/g) ?? []).filter((word) => !filler.has(word));
  return { found, numbers, pure: found.length > 0 && leftovers.length === 0 };
}

/** «Ha manifestado dolor» (afirmado y actual) junto a «sin dolor»: se pregunta, no se elige. */
function painContradiction(said: string[]): string | null {
  const folded = said.map(fold);
  if (!folded.some((line) => /\bsin dolor\b/.test(line))) return null;
  const affirmed = folded.some((line) => line.split(/[,:]|\bpero\b/).some((clause) =>
    REPORT.test(clause) && /\bdolor\b/.test(clause)
    && !/\b(?:no|niega|sin|ningun|ayer|antes|previo|previamente|anterior|anoche|semanas?|dias?)\b/.test(clause)));
  return affirmed ? "El dictado dice «sin dolor» y también que el paciente ha manifestado dolor. Confirma cuál corresponde antes de guardar." : null;
}

/** Ajusta `nota.motivo`, `nota.anamnesis` y `nota.examen`. Devuelve los avisos para el profesional. */
export function keepToothObservations(nota: Record<string, unknown>, transcript: string): string[] {
  const said = splitSentences(transcript);
  const warnings: string[] = [];
  const contradiction = painContradiction(said);
  if (contradiction) warnings.push(contradiction);

  const reported = said.filter((line) => REPORT.test(fold(line))).map((line) => read(line, NOTE_FILLER));
  const dictated = new Map<string, { text: string; reading: Reading }>();
  for (const line of said) {
    if (REPORT.test(fold(line)) || /\bpaciente\b/.test(fold(line)) || !TOOTH_WORD.test(fold(line))) continue;
    const reading = read(line, DICTATED_FILLER);
    const key = `${reading.found.join("+")}|${reading.numbers.join(",")}`;
    if (reading.pure && !dictated.has(key)) dictated.set(key, { text: line, reading });
  }

  // Con varias piezas nombradas, una frase dictada sin número no autoriza a mover lo que la nota dice de una pieza concreta.
  const teethNamed = new Set([...fold(transcript).matchAll(/\b(?:pieza|diente)\s+(\d+(?:\.\d)?)/g)].map((match) => match[1]));

  const KEYS = ["motivo", "anamnesis", "examen"] as const;
  const sections = KEYS.map((key) => ({ key, parts: typeof nota[key] === "string" ? splitSentences(nota[key] as string) : [], changed: false }));
  const exam = sections[2]!;

  for (const { text, reading } of dictated.values()) {
    // Dos observaciones sin número de pieza no se pueden distinguir en la nota: no se toca.
    if (dictated.size > 1 && !reading.numbers.length) continue;
    const sameTooth = (numbers: string[]) => reading.numbers.length
      ? numbers.every((value) => reading.numbers.includes(value))
      : !numbers.length || teethNamed.size <= 1;
    const fragments = sections.flatMap((section) => section.parts.map((part) => ({ section, part, said: read(part, NOTE_FILLER) })))
      .filter((item) => item.said.pure && sameTooth(item.said.numbers) && item.said.found.every((name) => reading.found.includes(name)))
      // Si el paciente también lo contó en el dictado, «Refiere…» es correcto y se respeta.
      .filter((item) => !(REPORT.test(fold(item.part)) && reported.some((other) => item.said.found.every((name) => other.found.includes(name)))));
    if (!fragments.length) continue;
    const only = fragments[0]!;
    if (fragments.length === 1 && only.section === exam && !REPORT.test(fold(only.part)) && only.said.found.length === reading.found.length) continue;
    // ¿Examen ya dice todo junto, dentro de una frase con más datos? Entonces solo sobran los fragmentos.
    const alreadyWhole = exam.parts.some((part) => !fragments.some((item) => item.section === exam && item.part === part)
      && !REPORT.test(fold(part)) && reading.found.every((name) => read(part, NOTE_FILLER).found.includes(name)));
    const examIndex = fragments.find((item) => item.section === exam);
    const at = examIndex ? exam.parts.indexOf(examIndex.part) : exam.parts.length;
    for (const { section, part } of fragments) {
      section.parts.splice(section.parts.indexOf(part), 1);
      section.changed = true;
    }
    if (!alreadyWhole) {
      const sentence = `${text.charAt(0).toUpperCase()}${text.slice(1)}`.replace(/[;,]?$/, "");
      exam.parts.splice(Math.min(at, exam.parts.length), 0, /[.!?]$/.test(sentence) ? sentence : `${sentence}.`);
      exam.changed = true;
    }
  }

  for (const section of sections) if (section.changed) nota[section.key] = section.parts.join(" ");

  // La vitalidad la constata el profesional: si la nota igual se la atribuye al paciente, se avisa.
  const patientSaidVital = said.some((line) => REPORT.test(fold(line)) && /\bvital/.test(fold(line)));
  const attributed = sections.slice(0, 2).flatMap((section) => section.parts).find((part) => REPORT.test(fold(part)) && /\bvital/.test(fold(part)));
  if (attributed && !patientSaidVital) warnings.push(`La nota atribuye al paciente un hallazgo que no dictaste así: «${attributed}». Revísalo antes de guardar.`);
  return warnings;
}
