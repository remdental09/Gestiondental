/** Piezas FDI escritas con punto (1.1, 3.6), excluyendo medidas como «1.5 mm». */
export function fdiMentions(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/(?<![\d.,/])([1-8])\.([1-8])(?![\d.])(?!\s*(?:mm|ml|mg|%|cm|g\b))/gi)) found.add(`${m[1]}.${m[2]}`);
  return [...found];
}

/** Aviso cuando el título y el texto de la evolución nombran piezas distintas (p. ej. título 2.1 y texto 1.1). */
export function toothMismatch(title: string, body: string): { title: string[]; body: string[] } | null {
  const inTitle = fdiMentions(title), inBody = fdiMentions(body);
  if (!inTitle.length || !inBody.length) return null;
  return inTitle.some(tooth => inBody.includes(tooth)) ? null : { title: inTitle, body: inBody };
}
