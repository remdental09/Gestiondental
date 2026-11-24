/**
 * Titular corto de una evolución («Restauración de composite palatino»): lo que se hizo ese día, en una línea,
 * para ubicar una atención sin abrirla. Se deriva del texto ya guardado (prestaciones, procedimientos, plan),
 * sin llamar a la IA ni inventar datos: si la nota no dice qué se hizo, el titular lo dice así.
 */

const HEADINGS = [
  "Motivo de consulta", "Anamnesis y antecedentes", "Examen", "Diagnóstico", "Procedimientos realizados",
  "Plan de tratamiento", "Indicaciones", "Prestaciones (arancel)", "Examen (odontograma)", "Diagnósticos (CIE-11)",
] as const;

const MAX = 90;

export function noteSections(body: string): Record<string, string> {
  const sections: Record<string, string> = {};
  let current: string | null = null;
  for (const raw of body.split(/\r?\n/u)) {
    const line = raw.trim();
    const heading = HEADINGS.find(name => name.toLocaleLowerCase("es-CL") === line.toLocaleLowerCase("es-CL"));
    if (heading) { current = heading; sections[heading] ??= ""; continue; }
    if (current && line) sections[current] = sections[current] ? `${sections[current]}\n${line}` : line;
  }
  return sections;
}

const capitalize = (text: string) => text ? text[0].toLocaleUpperCase("es-CL") + text.slice(1) : text;

function clip(text: string): string {
  const clean = text.replace(/\s+/gu, " ").trim().replace(/[.;:,\s]+$/u, "");
  if (clean.length <= MAX) return clean;
  const cut = clean.slice(0, MAX - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 40 ? cut.slice(0, space) : cut).replace(/[.;:,\s]+$/u, "")}…`;
}

const sentences = (text: string) => text.replace(/\s+/gu, " ").split(/(?<=[.!?])\s+/u).map(part => part.trim()).filter(Boolean);

/** «Se realiza restauración…» → «restauración…». Solo quita el verbo de apertura. */
const stripLead = (sentence: string) => sentence
  .replace(/[.]+$/u, "")
  .replace(/^se\s+(?:realiza|efectúa|efectua|ejecuta|lleva a cabo|procede a|planifica|planea|indica|solicita)\s+(?:(?:realizar|efectuar|ejecutar|hacer)\s+)?(?:(?:una?|el|la|los|las)\s+)?/iu, "");

const SUPPORT_ONLY = /^se\s+(?:administra|aplica|realiza|efectúa|efectua)\s+(?:(?:una?\s+)?anestesia|(?:un\s+)?aislamiento)/iu;
const NO_PROCEDURE = /no\s+se\s+(?:realizan|realizó|realiza|efectuaron)\s+procedimientos|sin\s+procedimientos/iu;

function fromServices(text: string): string {
  const names: string[] = [];
  for (const line of text.split(/\n/u)) {
    const name = line.replace(/^\s*[\w-]*\d[\w-]*\s*·\s*/u, "").replace(/\s*\(FDI[^)]*\)\s*$/iu, "").replace(/\s+/gu, " ").trim();
    if (name && !names.some(existing => existing.toLocaleLowerCase("es-CL") === name.toLocaleLowerCase("es-CL"))) names.push(name);
  }
  if (!names.length) return "";
  const shown = names.slice(0, 2).join(" + ");
  return names.length > 2 ? `${shown} +${names.length - 2} más` : shown;
}

function fromProcedures(text: string): string {
  if (!text || NO_PROCEDURE.test(text)) return "";
  const all = sentences(text);
  const main = all.filter(sentence => !SUPPORT_ONLY.test(sentence));
  const chosen = (main.length ? main : all).map(stripLead).filter(Boolean);
  if (!chosen.length) return "";
  let line = chosen[0];
  for (const next of chosen.slice(1)) {
    if (`${line}, ${next}`.length > MAX) break;
    line = `${line}, ${next[0].toLocaleLowerCase("es-CL")}${next.slice(1)}`;
  }
  return line;
}

export function evolutionHeadline(note: { title: string; body: string }): string {
  const sections = noteSections(note.body);
  const procedures = fromProcedures(sections["Procedimientos realizados"] ?? "");
  const services = fromServices(sections["Prestaciones (arancel)"] ?? "");
  if (procedures) return clip(capitalize(procedures));
  if (services) return clip(services);
  const plan = sentences(sections["Plan de tratamiento"] ?? "")[0];
  if (plan) return clip(`Evaluación y plan: ${stripLead(plan)}`);
  if (sections["Examen"] || sections["Diagnóstico"] || sections["Motivo de consulta"]) return "Evaluación / examen";
  const lines = note.body.split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
  const first = lines[0] ? sentences(lines[0])[0] : "";
  return clip(first || note.title || "Evolución clínica");
}

/** Zona de una línea por pieza («1.2 Resina ✓» → «1.2», «6 sextantes …» → «6 sextantes»). */
export function zoneOfPiece(text: string): string {
  const match = text.match(/^(\d\.\d+|boca completa|\d+\s+sextantes?|arcada\s+\S+|cuadrante\s+\d)/iu);
  return match ? match[1] : "";
}
