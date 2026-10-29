// Only an affirmative, completed placement with a local tooth reference changes the chart.
// In this Chilean application, "pieza N" (1–32) uses national numbering; FDI must be labeled.
const chileToFdi: Record<number, number> = {};
for (let position = 1; position <= 8; position++) {
  chileToFdi[position] = 19 - position;
  chileToFdi[position + 8] = 20 + position;
  chileToFdi[position + 16] = 49 - position;
  chileToFdi[position + 24] = 30 + position;
}

export function installedImplantTeeth(body: string): number[] {
  const result = new Set<number>();
  for (const sentence of body.split(/[;\n]+|\.(?!\d)/)) {
    // A plan, a negation, or a historical quotation is not an installed implant.
    if (!/\b(?:se\s+instal[oó]|se\s+coloc[oó]|se\s+insert[oó])\s+(?:un\s+)?implante\b/i.test(sentence) ||
        /\b(?:no\s+se\s+instal[oó]|no\s+se\s+coloc[oó]|no\s+se\s+insert[oó]|sin\s+instalar|se\s+planifica|se\s+planific[oó]|se\s+indica|se\s+program[oó])\b/i.test(sentence)) continue;
    const clauses = sentence.split(/\s+(?:y|adem[aá]s)\s+(?=(?:se\s+)?(?:instal[oó]|coloc[oó]|insert[oó])|(?:un\s+)?implante)|[,;]\s*(?=(?:se\s+)?(?:instal[oó]|coloc[oó]|insert[oó]))/i);
    for (const clause of clauses) {
      if (!/\bimplante\b/i.test(clause) || /\b(?:no|planifica|indica|programa)\b/i.test(clause)) continue;
      const placements = [...clause.matchAll(/(?:pieza|sitio|zona|[aá]rea)\s+(?:(FDI|ISO|chilena|nacional)\s*)?(\d{1,2}(?:\.\d)?)(?!\d)/gi)];
      for (const match of placements) {
        const raw = Number(match[2].replace(".", ""));
        const explicitlyFdi = /^(FDI|ISO)$/i.test(match[1] ?? "") || match[2].includes(".");
        const fdi = explicitlyFdi ? raw : chileToFdi[raw];
        if (fdi && fdi >= 11 && fdi <= 48 && fdi % 10 >= 1 && fdi % 10 <= 8) result.add(fdi);
      }
    }
  }
  return [...result].sort((a,b) => a-b);
}
