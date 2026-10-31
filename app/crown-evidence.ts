// Only an explicitly cemented definitive single-tooth restoration is projected.
export type CrownEvidence = { tooth: number; material: string | null; shade: string | null; onImplant: boolean };

/** Corona o prótesis fija dicha sobre un implante. No incluye «corona en la pieza». */
export function isCrownOnImplantText(text: string): boolean {
  return /\b(?:corona|pr[oó]tesis\s+fija)\b/i.test(text)
    && /\b(?:sobre|encima\s+de|en)\s+(?:el\s+|la\s+|un\s+)?implante\b/i.test(text);
}

export function cementedCrownFromEvolution(body: string): CrownEvidence | null {
  const mentions = [...body.matchAll(/\bpieza\s+(?:(FDI|ISO|chilena|nacional)\s*)?(\d{1,2}(?:\.\d)?)(?!\d)/gi)];
  if (mentions.length !== 1) return null;
  const mention = mentions[0];
  const code = Number(mention[2].replace(".", ""));
  const explicitlyFdi = /^(?:FDI|ISO)$/i.test(mention[1] ?? "") || mention[2].includes(".");
  const quadrant = Math.floor(code / 10), position = code % 10;
  const tooth = explicitlyFdi ? (quadrant >= 1 && quadrant <= 4 && position >= 1 && position <= 8 ? code : null)
    : code >= 1 && code <= 8 ? 19 - code
    : code >= 9 && code <= 16 ? code + 12
    : code >= 17 && code <= 24 ? 49 - (code - 16)
    : code >= 25 && code <= 32 ? 30 + (code - 24) : null;
  if (!tooth) return null;
  const hasDefinitive = /\bcorona\b/i.test(body) || /\bpr[oó]tesis\s+fija\s+definitiva\b/i.test(body);
  const hasPlacement = /\b(?:se\s+cement[aó]|se\s+instal[oó]|se\s+coloc[oó]|cement[oó])/i.test(body);
  const negated = /\b(?:no\s+se\s+cement[aó]|no\s+se\s+instal[oó]|no\s+se\s+coloc[oó]|sin\s+cementar)/i.test(body);
  if (!hasDefinitive || !hasPlacement || negated || (/\bprovisori[ao]\b/i.test(body) && !/\bdefinitiv[ao]\b/i.test(body))) return null;
  const material = /\b(?:zirconio|circonio)\b/i.test(body) ? "Zirconio"
    : /\bdisilicato\b/i.test(body) ? "Disilicato"
    : /\bmetal[ -]?cer[aá]mica\b/i.test(body) ? "Metal cerámica"
    : /\bresina\b/i.test(body) ? "Resina" : null;
  const shade = body.match(/\bcolor\s+([A-D][1-4](?:\.5)?)\b/i)?.[1]?.toUpperCase() ?? null;
  return { tooth, material, shade, onImplant: isCrownOnImplantText(body) };
}
