import { correctDentalTerms, isDentalWord, phoneticKey } from "./dental-lexicon.ts";

// Utilidades puras para el dictado en español de Chile: números hablados, montos,
// fechas y horas relativas en America/Santiago, y la verificación de la corrección
// del texto mal oído. Solo depende del léxico dental: lo importan el servidor, el cliente y los tests.

export type CorrectionOrigin = "diccionario" | "ia";
export type TranscriptCorrection = {
  original: string;
  corrected: string;
  origin: CorrectionOrigin;
  applied: boolean;
  reason?: string;
};

export const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const UNITS: Record<string, number> = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25,
  veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
};
const TENS: Record<string, number> = { treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 };
const HUNDREDS: Record<string, number> = {
  cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300, cuatrocientos: 400, cuatrocientas: 400,
  quinientos: 500, quinientas: 500, seiscientos: 600, seiscientas: 600, setecientos: 700, setecientas: 700,
  ochocientos: 800, ochocientas: 800, novecientos: 900, novecientas: 900,
};
export const isNumberWord = (word: string) => {
  const w = fold(word);
  return w in UNITS || w in TENS || w in HUNDREDS || w === "mil" || w === "millon" || w === "millones";
};

export type NumberRun = { start: number; end: number; value: number; text: string; spoken: boolean };

const WORD = /[0-9A-Za-zÀ-ÿ$]+(?:[.,][0-9]+)*/g;

/** Números escritos con cifras o con palabras, en orden. «dos cuatro» son dos números (2 y 4); «veinticuatro» es uno. */
export function numberRuns(text: string): NumberRun[] {
  const tokens = [...text.matchAll(WORD)].map(m => ({ raw: m[0], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
  const runs: NumberRun[] = [];
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    const raw = token.raw.replace(/^\$/, "");
    const w = fold(raw);
    if (/^\d/.test(raw)) {
      let value: number;
      if (/^\d{1,3}(?:\.\d{3})+$/.test(raw)) value = Number(raw.replace(/\./g, ""));
      else if (/^\d+,\d+$/.test(raw)) value = Number(raw.replace(",", "."));
      else if (/^\d+(?:\.\d+)?$/.test(raw)) value = Number(raw);
      else value = Number(raw.match(/^\d+/)?.[0]);
      let end = token.end;
      const next = tokens[i + 1];
      if (next && fold(next.raw) === "mil" && Number.isFinite(value)) { value *= 1000; end = next.end; i++; }
      else if (next && /^millon(es)?$/.test(fold(next.raw))) { value *= 1_000_000; end = next.end; i++; }
      runs.push({ start: token.start, end, value, text: text.slice(token.start, end), spoken: false });
      i++;
      continue;
    }
    if (!isNumberWord(w)) { i++; continue; }
    // Agrupa palabras numéricas en un solo número solo cuando la gramática lo permite.
    let total = 0, current = 0, last: "unit" | "tens" | "hundred" | "mil" | "and" | null = null, j = i, end = token.end, consumed = false;
    while (j < tokens.length) {
      const t = fold(tokens[j].raw);
      if (t === "y" && last === "tens" && j + 1 < tokens.length && (UNITS[fold(tokens[j + 1].raw)] ?? 0) >= 1 && (UNITS[fold(tokens[j + 1].raw)] ?? 0) <= 9) { last = "and"; j++; continue; }
      if (t in UNITS) {
        const v = UNITS[t];
        if (last === "unit" || last === "tens") break;
        if (last === "and" && v > 9) break;
        current += v; last = "unit";
      } else if (t in TENS) {
        if (last === "unit" || last === "tens" || last === "and") break;
        current += TENS[t]; last = "tens";
      } else if (t in HUNDREDS) {
        if (last === "unit" || last === "tens" || last === "hundred" || last === "and") break;
        current += HUNDREDS[t]; last = "hundred";
      } else if (t === "mil") {
        if (last === "mil" || last === "and") break;
        total += (current || 1) * 1000; current = 0; last = "mil";
      } else if (t === "millon" || t === "millones") {
        if (last === "and") break;
        total = (total + (current || 1)) * 1_000_000; current = 0; last = "mil";
      } else break;
      end = tokens[j].end; consumed = true; j++;
    }
    if (!consumed) { i++; continue; }
    runs.push({ start: token.start, end, value: total + current, text: text.slice(token.start, end), spoken: true });
    i = j;
  }
  return runs;
}

/** Firma numérica de un fragmento: «2.4» y «dos cuatro» → [2,4]; «50.000» y «cincuenta mil» → [50000]. */
export function numberSignature(text: string): number[] {
  const out: number[] = [];
  for (const run of numberRuns(text)) {
    if (run.spoken && /^(?:un|una)$/i.test(run.text)) continue; // artículo, no cifra
    const raw = run.text.replace(/^\$/, "");
    if (!run.spoken && /^\d\.\d$/.test(raw)) out.push(Number(raw[0]), Number(raw[2]));
    else out.push(run.value);
  }
  return out;
}

/** Montos en pesos (≥ 1.000) dichos con cifras o palabras. */
export function spokenAmounts(text: string): Array<{ value: number; text: string }> {
  return numberRuns(text)
    .filter(run => run.value >= 1000 && run.value <= 1_000_000_000 && Number.isSafeInteger(run.value))
    .map(run => ({ value: run.value, text: run.text }));
}

const SPOKEN_SMALL = (word: string): number | null => {
  const w = fold(word);
  if (/^\d{1,2}$/.test(w)) return Number(w);
  if (w in UNITS && UNITS[w] <= 20) return UNITS[w];
  return null;
};

/** Profundidad de sondaje en mm, con cifras o palabras («cuatro milímetros», «4 mm», «de 5»). */
export function depthFrom(text: string): number | null {
  const n = fold(text);
  const unit = n.match(/\b(\d{1,2}|[a-z]+)\s*(?:mm|milimetros?)\b/);
  if (unit) { const v = SPOKEN_SMALL(unit[1]); if (v !== null && v <= 20) return v; }
  const after = n.match(/\b(?:sondaje|sondeo|profundidad|bolsa)\s+(?:de\s+)?(\d{1,2}|[a-z]+)\b/);
  if (after) { const v = SPOKEN_SMALL(after[1]); if (v !== null && v <= 20) return v; }
  return null;
}

export type PaymentMethod = "efectivo" | "debito" | "credito" | "transferencia" | "otro";
export const PAYMENT_METHODS: PaymentMethod[] = ["efectivo", "debito", "credito", "transferencia", "otro"];
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = { efectivo: "Efectivo", debito: "Débito", credito: "Crédito", transferencia: "Transferencia", otro: "Otro" };
export function paymentMethodFrom(text: string): PaymentMethod | null {
  const n = fold(text);
  if (/\befectivo\b/.test(n)) return "efectivo";
  if (/\b(?:debito|redcompra)\b/.test(n)) return "debito";
  if (/\bcredito\b/.test(n)) return "credito";
  if (/\btransfer(?:encia|io|ido)\b/.test(n)) return "transferencia";
  if (/\b(?:cheque|vale vista)\b/.test(n)) return "otro";
  return null;
}
// Se aplican sobre fold(texto): sin tildes, para que \b funcione.
const PAYMENT_CUE_FOLDED = /\b(?:abon[oa]|pag[oa]|pagado|cancel[oa]|deja(?:\s+un)?\s+abono|pago\s+de)\b/;
const FUTURE_PAYMENT_FOLDED = /\b(?:debe|debera|tiene\s+que|va\s+a|pagara|abonara|cancelara|pagar|abonar|queda\s+pendiente|cobrar|cobra|(?:forma|medio|modalidad|plan)\s+de\s+pago|pago\s+en\s+cuotas)\b/;
export const isPaymentText = (text: string) => PAYMENT_CUE_FOLDED.test(fold(text));
/** Monto pagado: el primero que aparece después de «abonó / pagó», para no tomar el total del presupuesto dicho antes. */
export function paymentAmount(text: string): number | null {
  const nfc = text.normalize("NFC");
  const folded = fold(nfc);
  const at = folded.search(PAYMENT_CUE_FOLDED);
  const tail = at >= 0 && folded.length === nfc.length ? nfc.slice(at) : nfc;
  return spokenAmounts(tail)[0]?.value ?? spokenAmounts(nfc)[0]?.value ?? null;
}
export const isFuturePayment = (text: string) => FUTURE_PAYMENT_FOLDED.test(fold(text));

// ---------- Fechas y horas (America/Santiago) ----------

export function santiagoToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
const toUtc = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fromUtc = (date: Date) => date.toISOString().slice(0, 10);
export const addDays = (iso: string, days: number) => { const d = toUtc(iso); d.setUTCDate(d.getUTCDate() + days); return fromUtc(d); };
const validIso = (y: number, m: number, d: number) => { const date = new Date(Date.UTC(y, m - 1, d)); return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d; };
const pad = (n: number) => String(n).padStart(2, "0");
const WEEKDAYS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const WEEKDAY_LABEL = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
export const describeDate = (iso: string) => { const d = toUtc(iso); return `${WEEKDAY_LABEL[d.getUTCDay()]} ${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]} de ${d.getUTCFullYear()}`; };

export type SpokenDate = { date: string | null; said: string; doubt?: string; note?: string };

const smallNumber = (token: string): number | null => {
  const w = fold(token);
  if (/^\d{1,2}$/.test(w)) return Number(w);
  if (w === "primero") return 1;
  if (w in UNITS) return UNITS[w];
  return null;
};

/** Fecha dicha en relación con hoy (fecha de Chile). Devuelve null y una duda cuando no alcanza para fijarla. */
const original = (text: string, folded: string, match: RegExpMatchArray) => {
  const nfc = text.normalize("NFC");
  return nfc.length === folded.length && match.index !== undefined ? nfc.slice(match.index, match.index + match[0].length).trim() : match[0].trim();
};

export function resolveSpokenDate(text: string, today: string): SpokenDate | null {
  const n = fold(text.normalize("NFC"));
  const said = (match: RegExpMatchArray) => original(text, n, match);
  let m = n.match(/\b(\d{1,2}|[a-z]+)\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+(?:de(?:l)?\s+)?(\d{4}))?\b/);
  if (m) {
    const day = smallNumber(m[1]);
    const month = m[2] === "setiembre" ? 9 : MONTHS.indexOf(m[2]) + 1;
    if (day && day <= 31) {
      let year = m[3] ? Number(m[3]) : Number(today.slice(0, 4));
      if (!validIso(year, month, day)) return { date: null, said: said(m), doubt: `La fecha «${said(m)}» no existe.` };
      let iso = `${year}-${pad(month)}-${pad(day)}`;
      if (!m[3] && iso < today) { year += 1; iso = `${year}-${pad(month)}-${pad(day)}`; }
      return { date: iso, said: said(m) };
    }
  }
  m = n.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (m) {
    const day = Number(m[1]), month = Number(m[2]);
    let year = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : Number(today.slice(0, 4));
    if (validIso(year, month, day)) {
      let iso = `${year}-${pad(month)}-${pad(day)}`;
      if (!m[3] && iso < today) { year += 1; iso = `${year}-${pad(month)}-${pad(day)}`; }
      return { date: iso, said: said(m) };
    }
  }
  if (/\bpasado\s+manana\b/.test(n)) return { date: addDays(today, 2), said: "pasado mañana" };
  m = n.match(/\ben\s+(\d{1,2}|[a-z]+)\s+(dias|semanas|meses)\b/);
  if (m) {
    const count = smallNumber(m[1]);
    if (count && count <= 60) {
      if (m[2] === "dias") return { date: addDays(today, count), said: said(m) };
      if (m[2] === "semanas") return { date: addDays(today, count * 7), said: said(m), note: "Mismo día de la semana que hoy; ajústalo si la cita es otro día." };
      const d = toUtc(today); d.setUTCMonth(d.getUTCMonth() + count);
      return { date: fromUtc(d), said: said(m), note: "Fecha aproximada a un mes calendario; ajústala si corresponde." };
    }
  }
  m = n.match(/\b(?:(proximo|este|siguiente)\s+)?(lunes|martes|miercoles|jueves|viernes|sabado|domingo)(?:\s+(\d{1,2}))?(?:\s+(proximo|siguiente|que\s+viene|de\s+la\s+(?:proxima\s+semana|semana\s+que\s+viene)))?\b/);
  if (m) {
    const target = WEEKDAYS.indexOf(m[2]);
    const current = toUtc(today).getUTCDay();
    let delta = (target - current + 7) % 7;
    if (delta === 0) delta = 7;
    let note: string | undefined;
    if (m[4] && /semana/.test(m[4])) {
      // Día de la semana calendario siguiente (semana de lunes a domingo).
      const mondayNext = addDays(today, ((8 - current) % 7) || 7);
      const offset = (target + 6) % 7;
      return { date: addDays(mondayNext, offset), said: said(m) };
    }
    if (m[1] === "este" && delta === 7) delta = 0;
    const iso = addDays(today, delta);
    if (m[3]) {
      const day = Number(m[3]);
      if (Number(iso.slice(8)) !== day) return { date: null, said: said(m), doubt: `«${said(m)}» no calza con el calendario: ¿qué fecha es la cita?` };
    }
    if (delta === 0) note = "Es hoy.";
    return { date: iso, said: said(m), note };
  }
  if (/\b(?:la\s+)?(?:proxima\s+semana|semana\s+que\s+viene|semana\s+siguiente)\b/.test(n)) return { date: null, said: "la próxima semana", doubt: "Dijiste la próxima semana sin el día: ¿qué día y a qué hora?" };
  if (/(?<!\b(?:la|de la|en la|por la|esta|a la|las)\s)\bmanana\b/.test(n)) return { date: addDays(today, 1), said: "mañana" };
  if (/\bhoy\b/.test(n)) return { date: today, said: "hoy" };
  m = n.match(/\b(?:el\s+)?(?:dia\s+)(\d{1,2}|[a-z]+)\b/);
  if (m) {
    const day = smallNumber(m[1]);
    if (day && day >= 1 && day <= 31) {
      let [y, mo] = today.split("-").map(Number);
      let iso = `${y}-${pad(mo)}-${pad(day)}`;
      if (!validIso(y, mo, day) || iso < today) { mo += 1; if (mo > 12) { mo = 1; y += 1; } iso = `${y}-${pad(mo)}-${pad(day)}`; }
      if (validIso(y, mo, day)) return { date: iso, said: said(m), note: "Se asumió el próximo día con ese número; confirma el mes." };
    }
  }
  return null;
}

export type SpokenTime = { time: string | null; said: string; doubt?: string };

/** Hora dicha: «a las 10», «10:30», «a las diez y media», «a las 3 de la tarde», «al mediodía». */
export function resolveSpokenTime(text: string): SpokenTime | null {
  const n = fold(text.normalize("NFC"));
  if (/\b(?:al\s+)?medio\s*dia\b/.test(n)) return { time: "12:00", said: "mediodía" };
  const word = "(\\d{1,2}|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciseis|diecisiete|dieciocho|diecinueve|veinte)";
  const minutesWord = "(?:[:.h]\\s*(\\d{2})|\\s+y\\s+(media|cuarto|quince|treinta|cuarenta(?:\\s+y\\s+cinco)?|cinco|diez|veinte|\\d{2}))?";
  const re = new RegExp(`\\b(?:a\\s+las?|tipo|desde\\s+las?)\\s+${word}${minutesWord}(?:\\s*(?:horas|hrs|h)\\b)?(?:\\s+(de\\s+la\\s+manana|am|de\\s+la\\s+tarde|de\\s+la\\s+noche|pm))?`);
  let m = n.match(re);
  if (!m) m = n.match(new RegExp(`\\b(\\d{1,2})[:](\\d{2})()(?:\\s*(?:horas|hrs|h)\\b)?(?:\\s+(de\\s+la\\s+manana|am|de\\s+la\\s+tarde|de\\s+la\\s+noche|pm))?`));
  if (!m) m = n.match(new RegExp(`\\b(\\d{1,2})()()\\s+(?:horas|hrs)\\b()`));
  if (!m) return null;
  const hourRaw = m[1];
  let hour = /^\d+$/.test(hourRaw) ? Number(hourRaw) : (UNITS[hourRaw] ?? NaN);
  let minute = 0;
  if (m[2]) minute = Number(m[2]);
  else if (m[3]) {
    const extra: Record<string, number> = { media: 30, cuarto: 15, quince: 15, treinta: 30, "cuarenta y cinco": 45, cinco: 5, diez: 10, veinte: 20 };
    minute = /^\d+$/.test(m[3]) ? Number(m[3]) : (extra[m[3]] ?? NaN);
  }
  const qualifier = m[4] ?? "";
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute > 59 || hour > 23) return { time: null, said: original(text, n, m), doubt: `No se entendió la hora «${original(text, n, m)}».` };
  if (/tarde|noche|pm/.test(qualifier) && hour < 12) hour += 12;
  if (/manana|am/.test(qualifier) && hour === 12) hour = 0;
  const said = original(text, n, m);
  if (!qualifier && hour >= 1 && hour <= 7) return { time: `${pad(hour + 12)}:${pad(minute)}`, said, doubt: `Se asumió ${pad(hour + 12)}:${pad(minute)} (de la tarde) para «${said}»: confirma la hora.` };
  return { time: `${pad(hour)}:${pad(minute)}`, said };
}

const APPOINTMENT_CUE_FOLDED = /\b(?:proxim[ao]\s+(?:cita|control|sesion|atencion|hora)|(?:se\s+)?(?:cita|agenda|reagenda|cito|agendo)\s+(?:para|el|la|al|en|control)|control\s+(?:el|en|para)|vuelve\s+(?:el|en|a\s+control)|nos\s+vemos\s+(?:el|en|la|para|al|dentro)|(?:volver|regresar|regresa)\s+en|nueva\s+(?:cita|hora)|citar\s+(?:el|en|para)|se\s+controla(?:ra)?\s+(?:en|el|para|dentro))\b/;
export const isAppointmentText = (text: string) => APPOINTMENT_CUE_FOLDED.test(fold(text));

// ---------- Corrección del texto mal oído ----------

/** Errores frecuentes del reconocimiento de voz en dictado dental. Solo palabras que no tienen otro sentido clínico. */
const LEXICON: Array<[RegExp, string]> = [
  [/\bme\s?ci?al(es)?\b/gi, "mesial$1"],
  [/\bmecia(?:l|n)?\b/gi, "mesial"],
  [/\bmesia\b/gi, "mesial"],
  [/\bdis\s+tal\b/gi, "distal"],
  [/\bo\s+clusal\b/gi, "oclusal"],
  [/\boclu(?:sar|zal|cal)\b/gi, "oclusal"],
  [/\bocusal\b/gi, "oclusal"],
  [/\bbestibular\b/gi, "vestibular"],
  [/\bcarie\b/gi, "caries"],
  [/\bcaris\b/gi, "caries"],
  [/\b(?:ic\s?das|i\s?c\s?das|ikdas|icda|y\s?cdas|hic\s?das)\b/gi, "ICDAS"],
  [/\bson\s?daje\b/gi, "sondaje"],
  [/\bsondage\b/gi, "sondaje"],
  [/\bobtura(?:sion|zion)\b/gi, "obturación"],
  [/\bovturaci[oó]n\b/gi, "obturación"],
  [/\bendo\s+doncia\b/gi, "endodoncia"],
  [/\bexo\s+doncia\b/gi, "exodoncia"],
  [/\bimplan\s+te\b/gi, "implante"],
  [/\bperiodo\s+de\s+autograma\b/gi, "periodontograma"],
  [/\bperio\s?donto\s?grama\b/gi, "periodontograma"],
  [/\bautograma\b/gi, "odontograma"],
  [/\bodonto\s+grama\b/gi, "odontograma"],
  [/\blo\s?zart[aá]n\b/gi, "losartán"],
  [/\bamoxi\s+cilina\b/gi, "amoxicilina"],
  [/\bpeni\s+cilina\b/gi, "penicilina"],
  [/\bmilimetro(s)?\b/gi, "milímetro$1"],
  [/\bsupura(?:sion|zion)\b/gi, "supuración"],
  [/\ba\s+bono\b/gi, "abonó"],
  [/\bre\s?d\s?compra\b/gi, "Redcompra"],
  // Implantes: «técnica Flappers» → flapless (sin colgajo); «pieza 2,6» → 2.6 (FDI con punto).
  [/\bflap+(?:ers?|les+|leis|lis|ess)\b/gi, "flapless"],
  [/\b(pieza|diente)\s+([1-8]),([1-8])(?![\d,.])/gi, "$1 $2.$3"],
  // «pieza: 30» (dos puntos que pone el reconocimiento de voz) → «pieza 30».
  [/\b(pieza|diente)\s*:\s*(?=\d)/gi, "$1 "],
];

/**
 * Saludo y cierre dichos al dictar («Hola, quiero evolucionar la ficha de <nombre>», «eso es todo lo que quiero evolucionar»):
 * no son nota clínica. Se quitan del texto que se rutea; la transcripción literal se guarda igual al final.
 * Devuelve el nombre oído en el saludo para compararlo con el paciente abierto (sin enviarlo a la IA).
 */
const FRAME_OPEN = /^\s*(?:(?:hola|buenas?(?:\s+(?:tardes|d[ií]as|noches))?|ok|bueno|ya)[\s,.!]+)*(?:y\s+)?(?:(?:ahora\s+)?(?:quiero|quisiera|voy\s+a|vamos\s+a|necesito)\s+)(?:evolucionar|dictar|registrar|anotar|actualizar)(?:\s+(?:la\s+)?(?:ficha|evoluci[oó]n|atenci[oó]n|consulta))?(?:\s+(?:de|a|del|para)\s+(?:la\s+|el\s+)?(?:paciente\s+)?)?/iu;
const NAME_STOP = /^(?:la|el|los|las)\s+paciente\b|^paciente\b|^(?:viene|vino|acude|asiste|consulta|controla\p{L}*|control|se|hoy|motivo|refiere|presenta|tiene|est[aá]|con|pieza|diente)\b/iu;
const FRAME_CLOSE = /[\s,.;:]*\b(?:y\s+)?eso\s+(?:es|ser[ií]a)\s+todo(?:\s+lo\s+que\s+(?:quiero|quer[ií]a|voy\s+a)\s+(?:evolucionar|dictar|decir|registrar|anotar)(?:\s+(?:por\s+)?(?:ahora|hoy))?)?(?:\s+(?:por\s+)?(?:ahora|hoy))?(?:\s*,?\s*gracias)?[\s,.;:]*/giu;

export function stripDictationFrame(text: string): { text: string; corrections: TranscriptCorrection[]; spokenName: string; nameEnd: number } {
  let out = text;
  const corrections: TranscriptCorrection[] = [];
  let spokenName = "";
  let nameEnd = 0;
  const open = out.match(FRAME_OPEN);
  if (open && open.index === 0) {
    let rest = out.slice(open[0].length);
    // El nombre: hasta 8 palabras o hasta «la paciente», «viene», un signo… lo que llegue primero.
    const words: string[] = [];
    const wordRe = /^\s*([\p{L}'’-]+)/u;
    while (words.length < 8) {
      const trimmed = rest.replace(/^\s+/, "");
      if (!trimmed || /^[.,;:!?]/.test(trimmed) || NAME_STOP.test(trimmed)) break;
      const word = rest.match(wordRe);
      if (!word) break;
      words.push(word[1]);
      rest = rest.slice(word[0].length);
    }
    const said = `${open[0]}${words.join(" ")}`.trim();
    nameEnd = text.length - rest.length;
    spokenName = words.join(" ");
    const next = rest.replace(/^[\s,.;:]+/, "");
    out = next ? next.charAt(0).toUpperCase() + next.slice(1) : "";
    corrections.push({ original: said, corrected: "", origin: "diccionario", applied: true, reason: "Saludo del dictado: no es nota clínica (queda en la transcripción literal)." });
  }
  out = out.replace(FRAME_CLOSE, (match, offset: number, whole: string) => {
    corrections.push({ original: match.trim(), corrected: "", origin: "diccionario", applied: true, reason: "Cierre del dictado: no es nota clínica (queda en la transcripción literal)." });
    const tail = whole.slice(offset + match.length).trim();
    return tail ? ". " : "";
  });
  out = out.replace(/\.\s*([a-záéíóúñ])/g, (_, c: string) => `. ${c.toUpperCase()}`).trim();
  return { text: out || text, corrections: out ? corrections : [], spokenName: out ? spokenName : "", nameEnd: out ? nameEnd : 0 };
}

/** «implante de 33 × 8» → «3,3 × 8 mm»: diámetro por largo del implante, con coma decimal para no leerse como pieza 3.3. */
const IMPLANT_SIZE = /(?<![\d.,])([3-6])([0-9])\s*(?:×|x)\s*(\d{1,2})(?:\s*(?:mm|mil[ií]metros?))?(?![\d.,])/gi;

/** Frases mal oídas sin una corrección segura (se marcan como desconocidas). */
const UNKNOWN_PHRASES: Array<[RegExp, string]> = [
  [/\ben\s+la\s+mesa\b/i, " (¿«en boca»? ¿«en la mesial»? ¿«está estable»?)"],
];

/** Dichos que el diccionario no corrige solo: quedan como pregunta para el profesional. */
export function lexiconDoubts(text: string): string[] {
  const out: string[] = [];
  const brand = text.match(/\b(?:marca\s+)?(arc[iy]s+(?:\s+dos)?)\b/i);
  if (brand) out.push(`¿La marca del implante es Arcsys (FGM)? Se oyó «${brand[1]}»: confírmala o corrígela.`);
  const integral = text.match(/\bimplantes?\s+integral(?:es)?\b/i);
  if (integral) out.push(`Se oyó «${integral[0]}»: ¿es un implante oseointegrado o la marca/modelo del implante?`);
  // Frases que no tienen sentido clínico: se preguntan, no se adivinan.
  for (const [pattern, hint] of UNKNOWN_PHRASES) {
    const match = text.match(pattern);
    if (match) out.push(`Se oyó «${match[0].trim()}»: no se entendió${hint}. No se cambió; corrígelo si quieres que quede en la nota.`);
  }
  return out;
}

export function applyLexicon(text: string): { text: string; corrections: TranscriptCorrection[] } {
  let out = text;
  const corrections: TranscriptCorrection[] = [];
  for (const [pattern, replacement] of LEXICON) {
    out = out.replace(pattern, (match, ...groups) => {
      const value = replacement.replace(/\$(\d)/g, (_, i) => String(groups[Number(i) - 1] ?? ""));
      const keepCase = /^[A-ZÁÉÍÓÚ]/.test(match) && value === value.toLowerCase() ? value[0].toUpperCase() + value.slice(1) : value;
      if (fold(match) !== fold(keepCase) && !corrections.some(c => c.original === match && c.corrected === keepCase)) corrections.push({ original: match, corrected: keepCase, origin: "diccionario", applied: true });
      return keepCase;
    });
  }
  // Léxico odontológico: confusiones típicas del dictado y parecido fonético con términos dentales.
  const dental = correctDentalTerms(out);
  out = dental.text;
  for (const c of dental.corrections) if (fold(c.original) !== fold(c.corrected) && !corrections.some(x => x.original === c.original && x.corrected === c.corrected)) corrections.push({ original: c.original, corrected: c.corrected, origin: "diccionario", applied: true, reason: c.reason });
  // «$90,000» del reconocimiento de voz en inglés → «$90.000» (en Chile el punto separa los miles).
  out = out.replace(/\$\s?(\d{1,3}(?:,\d{3})+)(?![\d,])/g, (match, digits: string) => {
    const value = `$${digits.replace(/,/g, ".")}`;
    if (!corrections.some(c => c.original === match)) corrections.push({ original: match, corrected: value, origin: "diccionario", applied: true, reason: "monto en formato chileno" });
    return value;
  });
  if (/\bimplantes?\b/i.test(out)) {
    out = out.replace(IMPLANT_SIZE, (match, whole: string, decimal: string, length: string) => {
      const value = `${whole},${decimal} × ${length} mm`;
      if (!corrections.some(c => c.original === match)) corrections.push({ original: match, corrected: value, origin: "diccionario", applied: true });
      return value;
    });
  }
  return { text: out, corrections };
}

/** Palabras con sentido clínico o temporal propio: nunca se reemplazan por otra palabra distinta. */
const PROTECTED = new Set(("mesial distal oclusal incisal vestibular palatino palatina lingual bucal labial cervical proximal " +
  "caries sana sano sanas sanos ausente ausentes implante implantes corona coronas obturacion obturada obturado sellante resina amalgama restauracion fractura fracturada " +
  "exodoncia endodoncia extraida extraido extraccion activa activo inactiva inactivo incierta detenida " +
  "no si sin niega nunca nada ni tampoco mas menos solo " +
  "fdi iso chilena chileno nacional universal temporal temporales permanente " +
  "derecha derecho izquierda izquierdo superior inferior arriba abajo " +
  "hoy manana ayer lunes martes miercoles jueves viernes sabado domingo enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre semana semanas dias mes meses " +
  "efectivo debito credito transferencia cheque " +
  "sangrado sangra supuracion movilidad furca furcacion sondaje recesion " +
  "alergia alergias alergico alergica penicilina amoxicilina ibuprofeno paracetamol losartan metformina aspirina clorhexidina " +
  "media cuarto tarde noche " +
  "mg ml gramos dosis cada horas").split(/\s+/));
const INSERTABLE = new Set("pieza piezas diente dientes la el los las de del en y con a al cara caras mm por que se su".split(/\s+/));
const FILLERS = new Set("eh ehh eeh ehm em emm mmm este bueno ya ok okay".split(/\s+/));
const UNIT_FORMS: Record<string, string> = { milimetro: "mm", milimetros: "mm", mm: "mm", pesos: "", peso: "", clp: "", luca: "", lucas: "" };

const key = (token: string) => fold(token).replace(/[^a-z0-9.,$]/g, "").replace(/[.,]+$/, "").replace(/^[.,]+/, "");

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

const letterWords = (text: string) => fold(text).split(/[^a-z0-9]+/).filter(Boolean)
  .filter(w => !/^\d/.test(w) && w !== "$" && !isNumberWord(w) && w !== "y")
  .map(w => (w in UNIT_FORMS ? UNIT_FORMS[w] : w)).filter(Boolean);

function multisetMinus(a: string[], b: string[]) {
  const rest = [...b];
  const out: string[] = [];
  for (const w of a) { const i = rest.indexOf(w); if (i >= 0) rest.splice(i, 1); else out.push(w); }
  return out;
}

function dentalVerdict(removed: string[], added: string[]): { safe: boolean; reason?: string } | null {
  const content = added.filter(w => !INSERTABLE.has(w));
  if (!content.length) return null;
  const longDental = (w: string) => w.length >= 6 && isDentalWord(w);
  // Quitar un término dental correcto solo vale si lo nuevo es la misma palabra (plural, género, tilde)
  // o la contiene («gingival» → «supragingival»); «atrición» → «abrasión» no.
  for (const w of removed) {
    if (!longDental(w)) continue;
    const stem = fold(w).slice(0, -2);
    if (!content.some(c => fold(c).includes(stem))) return { safe: false, reason: "reemplaza un término que ya era válido" };
  }
  if (!content.every(isDentalWord)) return null;
  const ka = phoneticKey(removed.join("")), kb = phoneticKey(content.join(""));
  if (ka.length < 3) return null;
  const close = levenshtein(ka, kb) <= Math.max(1, Math.round(Math.max(ka.length, kb.length) * 0.4));
  // «traje» → «destartraje»: lo oído es el final o el comienzo del término.
  const inside = removed.every(w => w.length >= 4 && content.some(c => { const kc = phoneticKey(c), kw = phoneticKey(w); return kc.length > kw.length && (kc.endsWith(kw) || kc.startsWith(kw)); }));
  return close || inside ? { safe: true } : null;
}

/** Decide si un cambio propuesto por la IA solo corrige lo mal oído, sin cambiar el sentido. */
export function judgeCorrection(original: string, corrected: string): { safe: boolean; reason?: string } {
  const sigO = numberSignature(original), sigC = numberSignature(corrected);
  if (sigO.join("|") !== sigC.join("|")) return { safe: false, reason: "cambia números o piezas" };
  const wordsO = letterWords(original), wordsC = letterWords(corrected);
  const removed = multisetMinus(wordsO, wordsC).filter(w => !FILLERS.has(w));
  const added = multisetMinus(wordsC, wordsO).filter(w => !INSERTABLE.has(w));
  const repeated = multisetMinus(wordsO, wordsC).filter(w => wordsC.includes(w));
  if (!removed.length && !added.length) return { safe: true };
  if (removed.some(w => PROTECTED.has(w) && !repeated.includes(w))) return { safe: false, reason: "reemplaza un término que ya era válido" };
  if (!removed.length) return { safe: false, reason: "agrega contenido que no se dictó" };
  if (!added.length) return removed.every(w => FILLERS.has(w) || INSERTABLE.has(w)) ? { safe: true } : { safe: false, reason: "borra contenido dictado" };
  // Término dental mal oído: lo nuevo es léxico odontológico y suena como lo dictado
  // («traje supergival» → «destartraje supragingival»). Un término dental válido no se reemplaza por otro distinto.
  const dental = dentalVerdict(removed, added);
  if (dental) return dental;
  const a = removed.join(""), b = added.join("");
  const limit = Math.max(1, Math.round(Math.max(a.length, b.length) * 0.34));
  if (Math.min(a.length, b.length) < 3 || levenshtein(a, b) > limit) return { safe: false, reason: "no se parece a lo dictado" };
  return { safe: true };
}

/**
 * Compara el texto dictado con la versión corregida por la IA palabra a palabra y aplica solo los cambios seguros.
 * Lo que cambia números, piezas, negaciones o términos clínicos válidos se devuelve como «no aplicado».
 */
export function reconcileCorrection(source: string, aiText: string): { text: string; corrections: TranscriptCorrection[] } {
  const a = source.split(/\s+/).filter(Boolean), b = aiText.split(/\s+/).filter(Boolean);
  if (!b.length || !a.length) return { text: source, corrections: [] };
  if (b.length > a.length * 2 + 10 || b.length * 3 < a.length) return { text: source, corrections: [{ original: "(texto completo)", corrected: "(reescrito)", origin: "ia", applied: false, reason: "la IA reescribió demasiado; se dejó el texto dictado" }] };
  let pre = 0;
  while (pre < a.length && pre < b.length && key(a[pre]) === key(b[pre])) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && key(a[a.length - 1 - suf]) === key(b[b.length - 1 - suf])) suf++;
  const midA = a.slice(pre, a.length - suf), midB = b.slice(pre, b.length - suf);
  if (midA.length * midB.length > 1_500_000) return { text: source, corrections: [{ original: "(texto completo)", corrected: "(muy largo)", origin: "ia", applied: false, reason: "dictado demasiado largo para comparar; se dejó el texto dictado" }] };
  const ka = midA.map(key), kb = midB.map(key);
  const dp: Uint32Array[] = Array.from({ length: ka.length + 1 }, () => new Uint32Array(kb.length + 1));
  for (let i = ka.length - 1; i >= 0; i--) for (let j = kb.length - 1; j >= 0; j--) dp[i][j] = ka[i] === kb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: string[] = a.slice(0, pre).map((token, i) => (key(token) === key(b[i]) ? b[i] : token));
  const corrections: TranscriptCorrection[] = [];
  let i = 0, j = 0;
  const flush = (origTokens: string[], aiTokens: string[]) => {
    if (!origTokens.length && !aiTokens.length) return;
    const original = origTokens.join(" "), corrected = aiTokens.join(" ");
    if (origTokens.map(key).filter(Boolean).join(" ") === aiTokens.map(key).filter(Boolean).join(" ")) { out.push(...(aiTokens.length ? aiTokens : origTokens)); return; }
    const verdict = judgeCorrection(original, corrected);
    if (verdict.safe) { out.push(...aiTokens); corrections.push({ original: original || "—", corrected: corrected || "—", origin: "ia", applied: true }); }
    else { out.push(...origTokens); corrections.push({ original: original || "—", corrected: corrected || "—", origin: "ia", applied: false, reason: verdict.reason }); }
  };
  let hunkA: string[] = [], hunkB: string[] = [];
  while (i < ka.length || j < kb.length) {
    if (i < ka.length && j < kb.length && ka[i] === kb[j]) {
      flush(hunkA, hunkB); hunkA = []; hunkB = [];
      out.push(midB[j]); i++; j++;
    } else if (j < kb.length && (i >= ka.length || dp[i][j + 1] >= dp[i + 1][j])) { hunkB.push(midB[j]); j++; }
    else { hunkA.push(midA[i]); i++; }
  }
  flush(hunkA, hunkB);
  out.push(...a.slice(a.length - suf).map((token, k) => { const other = b[b.length - suf + k]; return key(token) === key(other) ? other : token; }));
  return { text: out.join(" "), corrections };
}

// ---------- Autocorrecciones dictadas («la 2.4, no, perdón, la 2.5») ----------
const SPOKEN_UNIT = "(?:uno|dos|tres|cuatro|cinco|seis|siete|ocho)";
const TOOTH_TOKEN = `(?:\\d\\.\\d|\\d{1,2}|${SPOKEN_UNIT}\\s+(?:punto\\s+)?${SPOKEN_UNIT})`;
const FIX_CUE = "(?:no[,\\s]+)?(?:perd[oó]n|mejor\\s+dicho|digo|corrijo|me\\s+equivoqu[eé])";
const TOOTH_INTRO = "(?:es\\s+)?(?:la\\s+|el\\s+|(?:pieza|diente)\\s+)?";
// Lo que va entre la pieza dicha y la corrección no puede nombrar otra pieza.
const NO_OTHER_TOOTH = "(?:(?!\\d\\.\\d|\\bpieza\\b|\\bdiente\\b)[^.;\\n])*?";
const NOT_A_TOOTH_AFTER = "(?![\\d.]?\\d)(?!\\s*(?:mil\\b|mm\\b|mil[ií]metros|pesos|%|hrs?\\b|horas))";
const SELF_FIX_TOOTH = new RegExp(`(?<![\\p{L}\\d.])((?:pieza|diente)\\s+)?(${TOOTH_TOKEN})${NOT_A_TOOTH_AFTER}(${NO_OTHER_TOOTH})[,\\s]+${FIX_CUE}[,:\\s]+${TOOTH_INTRO}(${TOOTH_TOKEN})${NOT_A_TOOTH_AFTER}`, "giu");
// «…la 2.4 caries mesial, no, la 2.5»: un «no» seguido de otra pieza con punto FDI también corrige.
// Solo si la pieza nueva cierra la frase («…, no, la 2.5.» o «…, no, la 2.5, caries…»): «caries no la 4.6 sana» no se toca.
const SELF_FIX_TOOTH_NO = /(?<![\p{L}\d.])(\d\.\d)((?:(?!\d\.\d|\bpieza\b|\bdiente\b)[^.;\n])*?)[,\s]+no[,\s]+(?:es\s+)?(?:la|el|(?:pieza|diente))\s+(\d\.\d)(?![\d.]?\d)(?=\s*(?:[,.;\n]|$))/giu;
const FACE = "(?:mesial|distal|oclusal|vestibular|palatin[ao]|lingual|incisal)";
const SELF_FIX_FACE = new RegExp(`(?<!\\p{L})${FACE}[,\\s]+${FIX_CUE}[,:\\s]+(${FACE})(?!\\p{L})`, "giu");

/**
 * Aplica las autocorrecciones dichas en voz alta: deja solo lo corregido y registra el cambio
 * para mostrarlo en «Texto corregido». Corre antes de las reglas y de la IA.
 */
export function applySelfCorrections(text: string): { text: string; corrections: TranscriptCorrection[] } {
  const corrections: TranscriptCorrection[] = [];
  const note = (original: string, corrected: string) => corrections.push({ original, corrected, origin: "diccionario", applied: true, reason: "Autocorrección dictada" });
  let out = text.replace(SELF_FIX_TOOTH, (whole, intro: string | undefined, old: string, middle: string, next: string) => {
    // Un número suelto («20 … perdón 30») no es una pieza: solo «pieza 20», «2.4» o «dos cuatro».
    if (/^\d{1,2}$/.test(old) && !intro) return whole;
    const value = `${intro ?? ""}${next}${middle}`;
    note(whole, value);
    return value;
  });
  out = out.replace(SELF_FIX_TOOTH_NO, (whole, _old: string, middle: string, next: string) => { const value = `${next}${middle}`; note(whole, value); return value; });
  out = out.replace(SELF_FIX_FACE, (whole, next: string) => { note(whole, next); return next; });
  return { text: out, corrections };
}
