/**
 * Dictado exclusivo del periodontograma. Convierte la transcripción en medidas por pieza y sitio,
 * con reglas fijas (sin IA): lo que no se entiende se devuelve aparte y nunca se inventa un valor.
 *
 * Numeración, igual que en el resto de la aplicación: «uno seis», «1.6» o «FDI 16» son FDI; un cardinal
 * sin etiqueta entre 1 y 32 («pieza 3», «pieza dieciséis») es numeración nacional chilena y se convierte a FDI.
 *
 * Forma de dictar: pieza, cara y tres números de mesial a distal.
 *   «uno seis vestibular tres dos cuatro, margen cero uno uno, sangrado mesial, palatino cinco seis cinco, movilidad dos»
 */
export type PerioDictationSite = "MV" | "V" | "DV" | "ML" | "L" | "DL";
export type PerioDictationReading = { depth?: number; margin?: number; bleeding?: boolean; suppuration?: boolean };
export type PerioDictationTooth = { tooth: number; sites: Partial<Record<PerioDictationSite, PerioDictationReading>>; mobility?: string; furcation?: string };
export type PerioDictationResult = { teeth: PerioDictationTooth[]; ignored: string[] };

const FACE_KEYS: Record<"V" | "L", [PerioDictationSite, PerioDictationSite, PerioDictationSite]> = { V: ["MV", "V", "DV"], L: ["ML", "L", "DL"] };
const NUMBER_WORDS: Record<string, number> = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18,
  veintiuno: 21, veintiun: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28,
};
const TENS: Record<string, number> = { treinta: 30, cuarenta: 40 };
const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3 };
const GRADE = ["0", "I", "II", "III"];
const FACE_WORD: Record<string, "V" | "L"> = { vestibular: "V", vestibulares: "V", bucal: "V", palatino: "L", palatina: "L", palatinos: "L", palatal: "L", lingual: "L", linguales: "L" };
const SITE_WORD: Record<string, 0 | 1 | 2> = { mesial: 0, mesiales: 0, central: 1, centro: 1, medio: 1, media: 1, distal: 2, distales: 2 };
const COMPOUND = /^(mesio|disto|medio|centro)(vestibular|bucal|palatino|palatina|palatal|lingual)$/;
const FILLER = new Set(["y", "de", "del", "en", "con", "la", "el", "los", "las", "a", "al", "mm", "milimetro", "milimetros", "grado", "clase", "tipo", "por", "cara", "sitio", "sitios", "tiene", "hay", "es", "son", "punto", "coma", "luego", "despues", "ahora", "numero", "se", "le", "lo", "gingival", "gingivales", "periodontal", "encia", "nivel", "valor", "valores", "mide", "miden", "marca", "marcan", "presenta", "superficie"]);

const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** Numeración nacional chilena (1–32) a FDI: 1–8 = 1.8–1.1, 9–16 = 2.1–2.8, 17–24 = 4.8–4.1, 25–32 = 3.1–3.8. */
export const chileToFdi = (n: number) => (n <= 8 ? 10 + (9 - n) : n <= 16 ? 20 + (n - 8) : n <= 24 ? 40 + (25 - n) : 30 + (n - 24));
const validTooth = (n: number) => Number.isInteger(n) && Math.floor(n / 10) >= 1 && Math.floor(n / 10) <= 4 && n % 10 >= 1 && n % 10 <= 8;

type Token = { kind: "num"; value: number; raw: string; pair?: number } | { kind: "word"; word: string };

function tokenize(text: string): Token[] {
  const clean = fold(text).replace(/(\d)\s*-\s*(?=\d)/g, "$1 ").replace(/\bmenos\s+(?=\d)/g, "-");
  const raw = clean.match(/-?\d+[.,]\d+|-?\d+|[a-zñ]+/g) ?? [];
  const tokens: Token[] = [];
  for (let i = 0; i < raw.length; i++) {
    const piece = raw[i];
    const dotted = piece.match(/^(\d)[.,](\d)$/);
    if (dotted) { tokens.push({ kind: "num", value: Number(dotted[1]) * 10 + Number(dotted[2]), raw: piece, pair: Number(dotted[1]) * 10 + Number(dotted[2]) }); continue; }
    if (/^-?\d+$/.test(piece)) { tokens.push({ kind: "num", value: Number(piece), raw: piece }); continue; }
    if (/^-?\d/.test(piece)) { tokens.push({ kind: "num", value: Math.round(Number(piece.replace(",", "."))), raw: piece }); continue; }
    if (piece in TENS) {
      const skip = raw[i + 1] === "y" ? 2 : 1, unit = NUMBER_WORDS[raw[i + skip]];
      if (unit >= 1 && unit <= 9) { tokens.push({ kind: "num", value: TENS[piece] + unit, raw: `${piece} ${raw[i + skip]}` }); i += skip; continue; }
      tokens.push({ kind: "num", value: TENS[piece], raw: piece }); continue;
    }
    if (piece in NUMBER_WORDS) { tokens.push({ kind: "num", value: NUMBER_WORDS[piece], raw: piece }); continue; }
    tokens.push({ kind: "word", word: piece });
  }
  // «tres punto seis» dictado con la palabra «punto» es la pieza FDI 3.6.
  const joined: Token[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const a = tokens[i], dot = tokens[i + 1], b = tokens[i + 2];
    if (a.kind === "num" && !a.pair && a.value >= 1 && a.value <= 4 && dot?.kind === "word" && (dot.word === "punto" || dot.word === "coma") && b?.kind === "num" && !b.pair && b.value >= 1 && b.value <= 8 && /^\D*\d?\D*$/.test(b.raw)) {
      joined.push({ kind: "num", value: a.value * 10 + b.value, raw: `${a.raw}.${b.raw}`, pair: a.value * 10 + b.value }); i += 2; continue;
    }
    joined.push(a);
  }
  return joined;
}

export function parsePerioDictation(text: string): PerioDictationResult {
  const tokens = tokenize(text);
  const teeth: PerioDictationTooth[] = [];
  const ignored: string[] = [];
  let current: PerioDictationTooth | null = null;
  let face: "V" | "L" = "V", mode: "depth" | "margin" = "depth", index = 0, single = false, marginSign = 1, negative = false;
  let expectTooth = false, fdiLabel = false, lost = false, gradeFor: "mobility" | "furcation" | null = null;
  let flag: { field: "bleeding" | "suppuration"; value: boolean; used: boolean } | null = null, negateFlag = false;

  const cur = () => current as unknown as PerioDictationTooth;
  const skip = (word: string) => { if (!ignored.includes(word)) ignored.push(word); };
  const site = (k: number) => { const key = FACE_KEYS[face][k]; return (cur().sites[key] ??= {}); };
  const flushFlag = () => {
    if (flag && !flag.used && current) for (let k = 0; k < 3; k++) site(k)[flag.field] = flag.value;
    flag = null;
  };
  const setTooth = (n: number) => {
    flushFlag();
    current = teeth.find(item => item.tooth === n) ?? null;
    if (!current) { current = { tooth: n, sites: {} }; teeth.push(current); }
    face = "V"; mode = "depth"; index = 0; single = false; marginSign = 1; expectTooth = false; fdiLabel = false; lost = false; gradeFor = null;
  };
  // Una pieza dictada que no existe: se descarta lo que siga hasta la próxima pieza válida, para no cargarlo a otra.
  const loseTooth = (raw: string) => { flushFlag(); skip(raw); current = null; lost = true; expectTooth = false; fdiLabel = false; };
    // Un cardinal sin etiqueta FDI entre 1 y 32 es numeración chilena; sobre 32 solo puede ser FDI.
  const cardinalTooth = (n: number) => (fdiLabel ? (validTooth(n) ? n : null) : n >= 1 && n <= 32 ? chileToFdi(n) : validTooth(n) ? n : null);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i], next = tokens[i + 1];
    if (token.kind === "word") {
      const word = token.word;
      if (word === "pieza" || word === "diente" || word === "fdi" || word === "iso") { flushFlag(); expectTooth = true; if (word === "fdi" || word === "iso") fdiLabel = true; gradeFor = null; continue; }
      if (word === "menos" || word === "negativo") { negative = true; continue; }
      if (word === "sin" || word === "no") { negateFlag = true; continue; }
      if (!current && !FILLER.has(word)) { skip(word); continue; }
      if (word in FACE_WORD) { flushFlag(); face = FACE_WORD[word]; mode = "depth"; index = 0; single = false; gradeFor = null; continue; }
      const compound = word.match(COMPOUND);
      if (compound) { flushFlag(); face = FACE_WORD[compound[2]]; index = compound[1] === "mesio" ? 0 : compound[1] === "disto" ? 2 : 1; single = true; gradeFor = null; continue; }
      if (word in SITE_WORD) {
        if (flag) { site(SITE_WORD[word])[flag.field] = flag.value; flag.used = true; }
        else { index = SITE_WORD[word]; single = true; }
        continue;
      }
      if (["sangrado", "sangra", "sangran", "sangramiento", "sangrante", "hemorragia"].includes(word)) { flushFlag(); flag = { field: "bleeding", value: !negateFlag, used: false }; negateFlag = false; gradeFor = null; continue; }
      if (["supuracion", "supura", "supuran", "pus"].includes(word)) { flushFlag(); flag = { field: "suppuration", value: !negateFlag, used: false }; negateFlag = false; gradeFor = null; continue; }
      if (["todos", "todas", "generalizado", "generalizada", "completo", "completa"].includes(word) && flag) { for (let k = 0; k < 3; k++) site(k)[flag.field] = flag.value; flag.used = true; continue; }
      if (["sondaje", "sondajes", "sondeo", "profundidad", "profundidades", "bolsa", "bolsas"].includes(word)) { flushFlag(); mode = "depth"; index = 0; single = false; gradeFor = null; continue; }
      if (["margen", "margenes", "recesion", "recesiones", "retraccion"].includes(word)) { flushFlag(); mode = "margin"; marginSign = 1; index = 0; single = false; gradeFor = null; continue; }
      if (["agrandamiento", "hiperplasia", "coronal", "sobrecrecimiento"].includes(word)) { flushFlag(); mode = "margin"; marginSign = -1; index = 0; single = false; gradeFor = null; continue; }
      if (word === "movilidad") { flushFlag(); gradeFor = "mobility"; continue; }
      if (word === "furca" || word === "furcacion") { flushFlag(); gradeFor = "furcation"; continue; }
      if (gradeFor && word in ROMAN) { cur()[gradeFor] = GRADE[ROMAN[word]]; gradeFor = null; continue; }
      if (!FILLER.has(word)) skip(word);
      continue;
    }

    // Números
    const value = token.value;
    const pairWithNext = !token.pair && value >= 1 && value <= 4 && next?.kind === "num" && !next.pair && next.value >= 1 && next.value <= 8 && /^\D*\d?\D*$/.test(next.raw) ? value * 10 + next.value : null;
    if (token.pair) { if (validTooth(token.pair)) setTooth(token.pair); else loseTooth(token.raw); continue; }
    if (expectTooth || !current) {
      if (lost && !expectTooth) { skip(token.raw); continue; }
      if (pairWithNext) { setTooth(pairWithNext); i++; continue; }
      const resolved = expectTooth || value >= 11 ? cardinalTooth(value) : null;
      if (resolved) { setTooth(resolved); continue; }
      loseTooth(token.raw); continue;
    }
    if (gradeFor) {
      if (value >= 0 && value <= 3) cur()[gradeFor] = gradeFor === "furcation" && value === 0 ? "" : GRADE[value]; else skip(token.raw);
      gradeFor = null; index = 3; continue;
    }
    const full = index >= 3;
    // Una pieza nueva sin decir «pieza»: solo cuando ya se dictaron los tres sitios de la cara en curso.
    if (full && pairWithNext) { setTooth(pairWithNext); i++; continue; }
    if (full && value >= 11 && cardinalTooth(value)) { setTooth(cardinalTooth(value)!); continue; }
    if (flag) flushFlag();
    if (full) { skip(token.raw); continue; }
    // «324» dictado de corrido son tres sondajes.
    if (mode === "depth" && index === 0 && !single && /^\d{3}$/.test(token.raw)) { token.raw.split("").forEach((digit, k) => { site(k).depth = Number(digit); }); index = 3; continue; }
    const signed = (negative || token.raw.startsWith("-") ? -Math.abs(value) : value) * (mode === "margin" ? marginSign : 1);
    negative = false;
    if (mode === "depth" ? signed < 0 || signed > 20 : signed < -10 || signed > 20) { skip(token.raw); continue; }
    site(index)[mode] = signed === 0 ? 0 : signed;
    index = single ? 3 : index + 1;
    if (single) { single = false; }
  }
  flushFlag();
  return { teeth: teeth.filter(item => Object.keys(item.sites).length || item.mobility !== undefined || item.furcation !== undefined), ignored };
}

const SITE_LABEL: Record<PerioDictationSite, string> = { MV: "mesial", V: "central", DV: "distal", ML: "mesial", L: "central", DL: "distal" };
/** Resumen legible de lo entendido para una pieza, para revisarlo antes de aplicarlo. */
export function describePerioDictation(item: PerioDictationTooth): string[] {
  const lines: string[] = [];
  (["V", "L"] as const).forEach(faceKey => {
    const keys = FACE_KEYS[faceKey], name = faceKey === "V" ? "Vestibular" : "Lingual / palatino";
    const parts: string[] = [];
    const row = (field: "depth" | "margin") => keys.some(key => item.sites[key]?.[field] !== undefined) ? keys.map(key => item.sites[key]?.[field] ?? "–").join(" · ") : null;
    const depth = row("depth"), margin = row("margin");
    if (depth) parts.push(`sondaje ${depth}`);
    if (margin) parts.push(`margen ${margin}`);
    (["bleeding", "suppuration"] as const).forEach(field => {
      const yes = keys.filter(key => item.sites[key]?.[field] === true).map(key => SITE_LABEL[key]);
      const no = keys.filter(key => item.sites[key]?.[field] === false).map(key => SITE_LABEL[key]);
      const label = field === "bleeding" ? "sangrado" : "supuración";
      if (yes.length) parts.push(`${label} ${yes.length === 3 ? "en los tres sitios" : yes.join(" y ")}`);
      if (no.length) parts.push(`sin ${label} ${no.length === 3 ? "en los tres sitios" : no.join(" y ")}`);
    });
    if (parts.length) lines.push(`${name}: ${parts.join("; ")}`);
  });
  if (item.mobility !== undefined) lines.push(`Movilidad ${item.mobility}`);
  if (item.furcation !== undefined) lines.push(item.furcation ? `Furcación ${item.furcation}` : "Sin furcación");
  return lines;
}
