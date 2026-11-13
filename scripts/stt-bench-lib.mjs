// Puntuación del banco de pruebas de dictado (sin red, sin dependencias).
// Mide tres cosas: WER (errores por palabra), reconocimiento de términos dentales y exactitud de piezas dentales.

const UNIDADES = { cero: 0, uno: 1, un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, veintiuno: 21, veintiun: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29 };
const DECENAS = { treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 };

/** Minúsculas, sin tildes (conserva ñ), sin puntuación; "3,5" → "3.5". */
export function baseNormalize(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/ñ/g, "\u0001")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\u0001/g, "ñ")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/%/g, " por ciento ")
    .replace(/[^\p{L}\p{N}.\s]/gu, " ")
    .replace(/(^|\s)\.+|\.+(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Convierte números hablados 0–99 ("treinta y seis" → "36"). Deja el resto igual. */
export function spokenNumbersToDigits(text) {
  const words = text.split(" ");
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w in DECENAS) {
      if (words[i + 1] === "y" && words[i + 2] in UNIDADES && UNIDADES[words[i + 2]] >= 1 && UNIDADES[words[i + 2]] <= 9) {
        out.push(String(DECENAS[w] + UNIDADES[words[i + 2]]));
        i += 2;
      } else { out.push(String(DECENAS[w])); }
    } else if (w in UNIDADES && w !== "un" && w !== "una") {
      out.push(String(UNIDADES[w]));
    } else out.push(w);
  }
  return out.join(" ");
}

export function normalize(text) { return spokenNumbersToDigits(baseNormalize(text)).replace(/(\d+) y medio\b/g, "$1.5"); }

export function tokens(text) { const n = normalize(text); return n ? n.split(" ") : []; }

/** WER = (sustituciones + inserciones + borrados) / palabras de la referencia. */
export function wer(reference, hypothesis) {
  const r = tokens(reference), h = tokens(hypothesis);
  if (!r.length) return h.length ? 1 : 0;
  let prev = Array.from({ length: h.length + 1 }, (_, j) => j);
  for (let i = 1; i <= r.length; i++) {
    const cur = [i];
    for (let j = 1; j <= h.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[h.length] / r.length;
}

/** Cuáles de los términos aparecen (sin tildes, sin mayúsculas) en la transcripción. */
export function termRecall(terms, hypothesis) {
  const hyp = ` ${normalize(hypothesis)} `;
  const found = [], missed = [];
  for (const term of terms) (hyp.includes(` ${normalize(term)} `) ? found : missed).push(term);
  return { found, missed, rate: terms.length ? found.length / terms.length : 1 };
}

/** Piezas dichas tras «pieza(s)» o «diente(s)»: "piezas 3 y 14" → ["3","14"]. */
export function extractTeeth(text) {
  const t = normalize(text).split(" ");
  const teeth = [];
  for (let i = 0; i < t.length; i++) {
    if (!/^(pieza|piezas|diente|dientes)$/.test(t[i])) continue;
    let j = i + 1;
    while (j < t.length) {
      if (/^\d{1,2}$/.test(t[j])) { teeth.push(t[j]); j += 1; }
      else if (/^(y|e|a|al)$/.test(t[j]) && /^\d{1,2}$/.test(t[j + 1] ?? "")) j += 1;
      else break;
    }
  }
  return teeth;
}

/** Fracción de las piezas de la referencia que aparecen (con multiplicidad) en la transcripción. */
export function toothAccuracy(reference, hypothesis) {
  const ref = extractTeeth(reference);
  if (!ref.length) return { rate: 1, expected: [], got: extractTeeth(hypothesis), missed: [] };
  const pool = extractTeeth(hypothesis);
  const got = [...pool];
  const missed = [];
  for (const tooth of ref) {
    const idx = pool.indexOf(tooth);
    if (idx >= 0) pool.splice(idx, 1); else missed.push(tooth);
  }
  return { rate: (ref.length - missed.length) / ref.length, expected: ref, got, missed };
}

export function scoreOne(entry, hypothesis) {
  const terms = termRecall(entry.terminos ?? [], hypothesis);
  const teeth = toothAccuracy(entry.texto, hypothesis);
  return { wer: wer(entry.texto, hypothesis), terms, teeth };
}

const pct = (x) => `${(x * 100).toFixed(1)} %`;
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** results: { motor: { id: texto } } → tabla markdown + errores de términos repetidos. */
export function buildReport(dictados, results) {
  const engines = Object.keys(results);
  const rows = [];
  const missedByEngine = {};
  for (const engine of engines) {
    const scores = [];
    const missed = new Map();
    for (const entry of dictados) {
      const hyp = results[engine][entry.id];
      if (typeof hyp !== "string") continue;
      const s = scoreOne(entry, hyp);
      scores.push({ entry, ...s });
      for (const term of s.terms.missed) missed.set(term, (missed.get(term) ?? 0) + 1);
    }
    const bySpec = {};
    for (const s of scores) (bySpec[s.entry.especialidad] ??= []).push(s);
    rows.push({
      engine, n: scores.length,
      wer: mean(scores.map((s) => s.wer)),
      terms: mean(scores.map((s) => s.terms.rate)),
      teeth: mean(scores.map((s) => s.teeth.rate)),
      bySpec: Object.fromEntries(Object.entries(bySpec).map(([k, v]) => [k, mean(v.map((s) => s.terms.rate))])),
    });
    missedByEngine[engine] = [...missed.entries()].sort((a, b) => b[1] - a[1]);
  }
  const lines = ["| Motor | Dictados | WER (menos es mejor) | Términos dentales reconocidos | Piezas correctas |", "|---|---|---|---|---|"];
  for (const r of rows) lines.push(`| ${r.engine} | ${r.n} | ${pct(r.wer)} | ${pct(r.terms)} | ${pct(r.teeth)} |`);
  const specs = [...new Set(dictados.map((d) => d.especialidad))];
  lines.push("", "Términos reconocidos por especialidad:", "", `| Motor | ${specs.join(" | ")} |`, `|---|${specs.map(() => "---").join("|")}|`);
  for (const r of rows) lines.push(`| ${r.engine} | ${specs.map((s) => (r.bySpec[s] === undefined ? "—" : pct(r.bySpec[s]))).join(" | ")} |`);
  for (const engine of engines) {
    const top = missedByEngine[engine].slice(0, 15);
    lines.push("", `Términos que más falla ${engine}:`, top.length ? top.map(([t, n]) => `- ${t} (${n})`).join("\n") : "- ninguno");
  }
  return { rows, markdown: lines.join("\n") };
}
