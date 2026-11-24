/**
 * Taquigrafía de clínica: las siglas que se escriben todos los días en la ficha (Dentalsoft y similares) y que el dictado
 * no entendía. «Pza 1.5 Rc MO … P60» quedaba como «Pulido coronario» y caries DO; «Cdto MV 18,5 mm»
 * y «OBC Guta» se cobraban como trepanación de urgencia; «A2% 1 tubo» se preguntaba.
 *
 * Se expande antes de leer el texto (reglas e IA), y cada cambio queda visible en «Texto corregido» con su motivo.
 * Solo se expanden siglas con un sentido único en este contexto; lo dudoso se deja tal cual (la IA recibe el glosario).
 */
import type { TranscriptCorrection } from "./spoken.ts";

/** Glosario para la IA y para la ayuda: sigla → significado. */
export const CLINIC_ABBREVIATIONS: ReadonlyArray<readonly [string, string]> = [
  ["Pza / Pzas / PZA", "pieza(s)"],
  ["Pcte / pct.", "paciente"],
  ["Rc / RC + caras (P, DO, MO, CV, IV, MOV, O-MOV-DO)", "restauración de resina compuesta en esas caras (es un acto REALIZADO, no una caries ni un pulido)"],
  ["CV", "cervical vestibular (clase V)"],
  ["IV (tras Rc)", "incisal y vestibular"],
  ["Denticlean", "limpiador cavitario (paso de la restauración, no un diagnóstico)"],
  ["Cap Hib", "capa híbrida (paso adhesivo)"],
  ["SBU / SB", "adhesivo Single Bond Universal / Single Bond"],
  ["Z250, Z350, P60 (Filtek)", "marca de resina compuesta"],
  ["A1–A4, B1–B4 (sin %)", "color VITA de la resina o corona"],
  ["A2% / A4% / A3-4% + tubos", "anestesia local (concentración del anestésico) y número de tubos"],
  ["ANL", "anestesia local"],
  ["Spix / Plexo / infiltrativa", "técnica anestésica"],
  ["Cdto", "conducto radicular (con su longitud de trabajo en mm)"],
  ["PQM", "preparación químico-mecánica de conductos"],
  ["RB25 / RB40 / RB50", "lima Reciproc Blue de ese calibre (no es una pieza)"],
  ["XPF", "lima XP-endo Finisher"],
  ["ref cusp", "referencia cuspídea de la longitud de trabajo"],
  ["NaOCl-EDTA-Suero", "irrigación endodóntica"],
  ["OBC", "obturación de conductos (endodoncia terminada)"],
  ["Guta / Totalfill", "gutapercha / sellador biocerámico TotalFill"],
  ["VI", "vidrio ionómero (sellado coronario)"],
  ["IRM", "obturación provisoria con IRM"],
  ["PFP", "prótesis fija plural (puente)"],
  ["Cdto. / Cementado con Ketac Cem, Duolink, U200", "cementación"],
  ["Cerec, E-Max, Enamic, I12/I14, LT/HT", "corona cerámica CAD/CAM: material, bloque y translucidez"],
  ["IOS", "escaneo intraoral"],
  ["ROG", "regeneración ósea guiada"],
  ["CBCT / CBTC", "tomografía computarizada de haz cónico"],
  ["ATB / AN / AINES", "antibiótico / analgésico / antiinflamatorios no esteroidales"],
  ["JIG", "desprogramador oclusal (registro o control de oclusión con JIG)"],
  ["An-Ab / An", "anotación de la clínica al cierre de la sesión (se deja tal cual en la nota; no es un material ni una pieza)"],
  ["PIT", "sigla de la clínica para la evaluación del plan de tratamiento (se deja tal cual)"],
  ["TiBase / TIBASE", "base de titanio: pilar sobre el que se cementa la corona CAD/CAM del implante"],
  ["Blqto / blqto", "blanqueamiento (intracameral o de pieza desvital, por sesiones)"],
  ["Tope cervical", "sellado cervical (habitualmente con vidrio ionómero) antes del blanqueamiento interno"],
  ["H de Ca", "hidróxido de calcio (medicación intraconducto)"],
  ["Perborato de Na / Peróxido de Na", "agente blanqueador intracameral"],
  ["B/W", "radiografías bitewing (aleta de mordida)"],
  ["Cone beam", "tomografía computarizada de haz cónico (CBCT)"],
];

/** Siglas del glosario que la IA no debe preguntar (se reconocen también con puntos, guiones o en minúsculas). */
const KNOWN_ABBREVIATIONS = [
  "Rc", "RC", "Pza", "Pzas", "Pcte", "Pct", "Cdto", "PQM", "OBC", "IRM", "PFP", "IOS", "ROG", "CBCT", "CBTC", "JIG", "XPF",
  "SBU", "SB", "ANL", "ATB", "AINES", "An-Ab", "An", "Ab", "PIT", "TiBase", "TIBASE", "Blqto", "Cap Hib", "Denticlean", "VI", "Guta",
  "Totalfill", "RB25", "RB40", "RB50", "Z250", "Z350", "P60", "H de Ca", "B/W", "Cerec", "Duolink", "Ketac", "U200",
];
const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[.\s]+/g, " ").trim();
const KNOWN_FOLDED = new Set(KNOWN_ABBREVIATIONS.map(fold));

/**
 * Duda de la IA que solo pregunta qué significa una sigla del glosario («¿Qué significa «An-Ab»?», «¿El JIG corresponde a un
 * desprogramador?»): sobra, la sigla tiene un único sentido en la clínica. Las dudas clínicas que la nombran (¿se hizo hoy?,
 * ¿qué zona del CBCT?) se mantienen.
 */
export function asksKnownAbbreviation(question: string): boolean {
  const quoted = [...question.matchAll(/[«“"]([^»”"]{1,24})[»”"]/g)].map((m) => fold(m[1]));
  const meaning = /qu[eé]\s+significa|significado|a\s+qu[eé]\s+(?:se\s+)?refiere|qu[eé]\s+(?:es|son)\s|abreviatura|sigla/i.test(question);
  if (meaning && quoted.some((q) => KNOWN_FOLDED.has(q))) return true;
  // «¿El «jig» corresponde a un plano desprogramador?»: confirma el significado que el glosario ya da.
  const confirmsMeaning = /^\s*(?:IA:\s*)?¿\s*(?:el|la|los|las)?\s*[«“"]?([\w/-]{2,12})[»”"]?\s+(?:corresponde|equivale|se\s+refiere|significa)\s+a\s+(?:un|una|el|la)?\s*([^?]{0,60})\??/i.exec(question);
  if (confirmsMeaning && KNOWN_FOLDED.has(fold(confirmsMeaning[1])) && !/hoy|realiz|planific|zona|maxilar|arcada|c[oó]digo|arancel|pieza/i.test(confirmsMeaning[2])) return true;
  return false;
}

/** Texto del glosario para el prompt de la IA. */
export function clinicShorthandPrompt(): string {
  return `Siglas de la clínica (taquigrafía habitual; úsalas para entender, no las preguntes): ${CLINIC_ABBREVIATIONS.map(([k, v]) => `${k} = ${v}`).join("; ")}.`;
}

const FACE_WORD: Record<string, string> = { M: "mesial", O: "oclusal", D: "distal", V: "vestibular", P: "palatino", L: "lingual", I: "incisal" };

/** «DO» → «distal y oclusal»; «CV» → «cervical vestibular»; «IV» → «incisal y vestibular». */
export function faceCodeWords(code: string): string | null {
  const c = code.toUpperCase();
  if (c === "CV" || c === "C") return "cervical vestibular";
  if (c === "CP" || c === "CL") return c === "CP" ? "cervical palatino" : "cervical lingual";
  if (!/^[MODVPLI]{1,5}$/.test(c)) return null;
  const words = [...new Set([...c].map((l) => FACE_WORD[l]))];
  if (words.length === 1) return words[0];
  return `${words.slice(0, -1).join(", ")} y ${words[words.length - 1]}`;
}

const TOOTH = String.raw`[1-8]\.[1-8]`;
const TEETH_LIST = String.raw`${TOOTH}(?:\s*(?:-|,|y|e)\s*${TOOTH})*`;
const FACE = String.raw`(?:CV|CP|CL|[MODVPLI]{1,5})`;
const FACES = String.raw`${FACE}(?:\s*-\s*${FACE})*`;
// «Pza(s) 4.7-4.5-3.5 Rc O-MOV-DO-» (las caras van en el orden de las piezas).
const PIECES_RC = new RegExp(String.raw`\b(Pzas?|PZAS?|Piezas?|piezas?)\.?\s+(${TEETH_LIST})\s+R[cC]\s*(?:clase\s+(?:I{1,3}|IV|V)\s*)?(${FACES})?(?=[\s\-/,.;:]|$)-?`, "g");
// «Rc» suelto tras una pieza o antes de caras: «la 1.6 Rc O», «Rc MO».
const LONE_RC = /(?<![\p{L}\d])R[cC](?=\s+(?:CV|CP|C|[MODVPLI]{1,5})(?:[\s\-/,.;:]|$))/gu;

const NEW_ACT = /^\s*(?:pulido|control\p{L}*|higiene|destartraje|detartraje|profilaxis|anestesia|se\s|paciente|pieza|piezas|indicaciones|indico|plan\b|rx\b|radiograf\p{L}*|ajuste|retiro|exodoncia|prox\p{L}*|pr[oó]xima|cone\s+beam|cbct|deriv\p{L}*|receto|instalo|toma|impresi[oó]n|escaneo|obturaci[oó]n\s+de\s+conductos|restauraci[oó]n|reconstrucci[oó]n|cementaci[oó]n|tallado|aplico|dejo|retira|hago|realizo)/iu;

/** Expande las siglas de la clínica. Devuelve el texto y las correcciones (visibles para el profesional). */
export function expandClinicShorthand(input: string): { text: string; corrections: TranscriptCorrection[] } {
  const corrections: TranscriptCorrection[] = [];
  const note = (original: string, corrected: string, reason: string) => {
    if (original !== corrected && !corrections.some((c) => c.original === original && c.corrected === corrected)) corrections.push({ original, corrected, origin: "diccionario", applied: true, reason });
  };
  let text = input
    // «Pza 1.1Trepanación» → «Pza 1.1 Trepanación»; «18.5mm» es una longitud (coma decimal), nunca la pieza 1.8.
    .replace(/(?<![\d.,])([1-8]\.[1-8])(?=\p{L})/gu, "$1 ")
    .replace(/(?<![\d.,])(\d{1,2})\.(\d)\s*mm\b/g, "$1,$2 mm");
  // 1) Resina compuesta por pieza y cara. Si hay tantas caras como piezas, cada pieza lleva la suya.
  text = text.replace(PIECES_RC, (all: string, _word: string, list: string, faces: string | undefined) => {
    const teeth = list.match(new RegExp(TOOTH, "g")) ?? [];
    const groups = (faces ?? "").split(/\s*-\s*/).filter(Boolean);
    let out: string;
    if (teeth.length > 1 && groups.length === teeth.length) {
      out = teeth.map((t, i) => `pieza ${t} restauración de resina compuesta ${faceCodeWords(groups[i]) ?? groups[i]}`).join("; ");
      out = out.charAt(0).toUpperCase() + out.slice(1);
    } else {
      const words = groups.map((g) => faceCodeWords(g) ?? g).join(" y ");
      const head = teeth.length > 1 ? `Piezas ${teeth.slice(0, -1).join(", ")} y ${teeth[teeth.length - 1]}` : `Pieza ${teeth[0]}`;
      out = `${head} restauración de resina compuesta${words ? ` ${words}` : ""}`;
    }
    note(all.trim(), out, "Rc = restauración de resina compuesta (sigla de la clínica); las caras van con su pieza.");
    return `${out} `;
  });
  text = text.replace(/(?<![\p{L}\d])R[cC]\s+de\s+mu[ñn][oó]n/gu, (all: string) => { const v = "reconstrucción de muñón con resina compuesta"; note(all, v, "Rc de muñón = reconstrucción de muñón con resina compuesta."); return v; });
  text = text.replace(LONE_RC, (all: string) => { note(all, "restauración de resina compuesta", "Rc = restauración de resina compuesta (sigla de la clínica)."); return "restauración de resina compuesta"; });
  // Caras sueltas tras «resina compuesta» que quedaron en letras: «resina compuesta DO» → «distal y oclusal».
  text = text.replace(/(resina compuesta)\s+(CV|CP|C|[MODVPLI]{1,5})(?=[\s\-/,.;:]|$)-?/g, (all: string, head: string, code: string) => {
    const words = faceCodeWords(code);
    if (!words) return all;
    note(all.trim(), `${head} ${words}`, "Caras escritas con letras.");
    return `${head} ${words}${all.endsWith("-") ? " " : ""}`;
  });
  const simple: Array<[RegExp, string | ((m: string, ...g: string[]) => string), string]> = [
    [/\b(?:Pzas|PZAS|pzas)(?:\b\.?|(?=\d))\s*/g, "Piezas ", "Pzas = piezas."],
    [/\b(?:Pza|PZA|pza)(?:\b\.?|(?=\d))\s*/g, "Pieza ", "Pza = pieza."],
    [/\b(?:Pcte|PCTE|pcte)\b\.?/g, "Paciente", "Pcte = paciente."],
    [/\bCap\s*Hib\b/g, "capa híbrida", "Cap Hib = capa híbrida (paso adhesivo)."],
    [/\bSBU\b/g, "adhesivo Single Bond Universal", "SBU = Single Bond Universal."],
    [/(?<=[-\s/])SB(?=[-\s/])/g, "adhesivo Single Bond", "SB = Single Bond."],
    [/\b([zZ])\s?(250|350)\b/g, (_m: string, _z: string, n: string) => `resina Filtek Z${n}`, "Z250/Z350 = resina compuesta Filtek."],
    [/\b[pP](60)\b/g, "resina Filtek P60", "P60 = resina compuesta Filtek P60."],
    // Color VITA pegado a guion o barra («SB-A3», «- B2»): «color A3». La anestesia lleva «%».
    [/(?<=[-/]\s?)([A-D][1-4](?:[.,]5)?)(?!\s*%|\s*-\s*\d\s*%|\d)/g, (_m: string, shade: string) => `color ${shade.replace(",", ".")}`, "Color VITA de la resina."],
    [/(?<!anestesia\s)\bA\s?([1-4](?:\s*-\s*[1-4])?)\s?%/g, (_m: string, c: string) => `anestesia al ${c.replace(/\s+/g, "")}%`, "A2% / A4% = anestesia local (concentración)."],
    [/\bANL\b/g, "anestesia local", "ANL = anestesia local."],
    [/\bCdtos\b\.?/gi, "conductos", "Cdto = conducto radicular."],
    [/\bCdto\b\.?/gi, "conducto", "Cdto = conducto radicular."],
    [/\bPQM\b/g, "preparación químico-mecánica", "PQM = preparación químico-mecánica."],
    [/\bXPF\b/g, "lima XP-endo Finisher", "XPF = XP-endo Finisher."],
    [/\bOBC\b/g, "obturación de conductos", "OBC = obturación de conductos."],
    [/\bGuta\b/gi, "gutapercha", "Guta = gutapercha."],
    [/(?<=[-/]\s?)VI\b(?!\s*sextante)/g, "vidrio ionómero", "VI = vidrio ionómero."],
    [/\bPFP\b/g, "prótesis fija plural", "PFP = prótesis fija plural."],
    [/\bIOS\b/g, "escaneo intraoral", "IOS = escaneo intraoral."],
    [/\bROG\b/g, "regeneración ósea guiada", "ROG = regeneración ósea guiada."],
    [/\bCBTC\b/g, "CBCT", "CBTC = CBCT."],
    [/\bATB\b/g, "antibiótico", "ATB = antibiótico."],
    [/(?<=antibi[oó]tico\s+y\s+)AN\b/g, "analgésico", "AN = analgésico."],
    [/\bAMOXI\b/gi, "amoxicilina", "Amoxi = amoxicilina."],
    // Error de tipeo frecuente en ficha («I,PLANTE»: la coma está junto a la m en el teclado).
    [/\b[iI],([pP][lL][aA][nN][tT][eE][sS]?)\b/g, (_m: string, rest: string) => `${/[A-Z]/.test(rest) ? "IM" : "im"}${rest}`, "«i,plante» = implante (error de tipeo)."],
    [/\b[Bb]lqto\b\.?/g, "blanqueamiento", "Blqto = blanqueamiento."],
    [/\bH\s+de\s+Ca\b/g, "hidróxido de calcio", "H de Ca = hidróxido de calcio."],
  ];
  for (const [pattern, replacement, reason] of simple) {
    text = text.replace(pattern, (...args: unknown[]) => {
      const match = String(args[0]);
      const groups = args.slice(1, -2).map((g) => (g === undefined ? "" : String(g)));
      const value = typeof replacement === "string" ? replacement : replacement(match, ...groups);
      note(match.trim(), value, reason);
      return value;
    });
  }
  // La barra separa actos en la ficha («Rc P … / Pulido / Control en 6 meses»): se lee como fin de frase, para que el control
  // o el pulido no arrastren a la restauración. No se toca en fechas (16/03), «B/W» ni entre cifras.
  if (/\S\s*\/\s*\S/.test(text)) {
    let slashes = 0;
    text = text.replace(/[ \t]*\/+[ \t]*/g, (all: string, offset: number, whole: string) => {
      const before = whole.slice(0, offset), after = whole.slice(offset + all.length);
      if (/\d$/.test(before) && /^\d/.test(after)) return all;
      if (/(?:^|[^\p{L}])[Bb]$/u.test(before) && /^[Ww](?:[^\p{L}]|$)/u.test(after)) return all;
      if (!before.trim() || !after.trim() || /^[\s.,;:]*$/.test(after)) return all.trim() ? " " : all;
      // Solo antes de un acto nuevo; materiales y pasos del mismo acto («/ Duolink», «/ Choise TR») siguen en la frase.
      if (!NEW_ACT.test(after)) return all;
      slashes += 1;
      return /[.;:]\s*$/.test(before) ? " " : ". ";
    });
    if (slashes) note("/", ". ", "La barra separa actos: se lee como fin de frase.");
  }
  return { text, corrections };
}
