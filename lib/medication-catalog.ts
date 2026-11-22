/**
 * Catálogo de productos farmacéuticos registrados en el ISP (Chile) para autocompletar la receta.
 * Fuente: buscador público del ISP, exportado el 22-nov-2026 (`public/datos/medicamentos-isp.json`, generado por
 * `scripts/build-medication-catalog.mjs`). Es un registro de productos, no de posología: nunca se infiere dosis ni concentración.
 */
export type CatalogFile = { version: number; exportado: string; control: string[]; filas: [string, string, string, number, string][] };
export type CatalogProduct = { registro: string; nombre: string; principioActivo: string; control: "" | "Psicotrópico" | "Estupefaciente"; key: string };
export type MedicationSuggestion =
  | { kind: "generico"; label: string; nombre: string; detalle: string; control: CatalogProduct["control"]; productos: number; forma: MedicationForm }
  | { kind: "producto"; label: string; nombre: string; detalle: string; control: CatalogProduct["control"]; registro: string; forma: MedicationForm };
export type MedicationForm = { unidad: string; via: string };

export const normalizeKey = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9/.,%\s-]/g, " ").replace(/\s+/g, " ").trim();

/** Convierte el archivo compacto en productos con clave de búsqueda sin tildes. */
export function loadCatalog(file: CatalogFile): CatalogProduct[] {
  const labels = file.control;
  return file.filas.map(([registro, nombre, principioActivo, control]) => ({
    registro, nombre, principioActivo, control: (labels[control] ?? "") as CatalogProduct["control"],
    key: normalizeKey(`${nombre} ${principioActivo.replace(/\/\//g, " ")}`),
  }));
}

const SMALL_UPPER = new Set(["bid", "tid", "sr", "xr", "ui", "ud", "hcl", "plus", "xl"]);
/** «AMBILAN BID 875/125 COMPRIMIDOS RECUBIERTOS» → «Ambilan BID 875/125 comprimidos recubiertos». Solo cambia mayúsculas. */
export function prettyName(raw: string): string {
  const words = raw.trim().split(/\s+/);
  const allUpper = raw === raw.toUpperCase();
  return words.map((word, i) => {
    if (!allUpper && word !== word.toUpperCase()) return word;
    const lower = word.toLowerCase();
    if (SMALL_UPPER.has(lower) && i > 0) return word.toUpperCase();
    if (!/[a-záéíóúñ]/i.test(word)) return word;
    return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
  }).join(" ").replace(/\bml\b/gi, "mL");
}
/** «ACIDO CLAVULANICO//AMOXICILINA» → «Acido clavulanico + amoxicilina» (el ISP entrega los principios activos sin tildes). */
export function prettyIngredient(raw: string): string {
  const text = raw.split("//").map(part => part.trim().toLowerCase()).filter(Boolean).join(" + ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Forma farmacéutica leída del nombre del producto → unidad y vía sugeridas (el profesional las confirma). Si no es clara, queda vacío. */
export function formFromName(name: string): MedicationForm {
  const n = normalizeKey(name);
  const has = (re: RegExp) => re.test(n);
  if (has(/vaginal|ovulo/)) return { unidad: "", via: "vaginal" };
  if (has(/oftalmic|colirio/)) return { unidad: "gota", via: "ocular" };
  if (has(/otic/)) return { unidad: "gota", via: "ótica" };
  if (has(/inyectable|ampolla|ampolleta|liofilizado/)) return { unidad: "ampolla", via: "" };
  if (has(/colutorio|enjuague/)) return { unidad: "enjuague", via: "enjuague bucal" };
  if (has(/gel|crema|ungüento|unguento|pomada|topic|cutane/)) return { unidad: "aplicación", via: has(/bucal|oral|encia/) ? "bucal" : "tópica" };
  if (has(/supositorio/)) return { unidad: "supositorio", via: "rectal" };
  if (has(/parche/)) return { unidad: "parche", via: "transdérmica" };
  if (has(/sublingual/)) return { unidad: "comprimido", via: "sublingual" };
  if (has(/capsula/)) return { unidad: "cápsula", via: "oral" };
  if (has(/comprimid|gragea|tableta|capleta|oblea/)) return { unidad: "comprimido", via: "oral" };
  if (has(/jarabe|suspension oral|solucion oral|emulsion oral|elixir/)) return { unidad: "ml", via: "oral" };
  if (has(/gotas orales|gotas$|solucion oral en gotas/)) return { unidad: "gota", via: "oral" };
  if (has(/sobre|granulado|polvo para suspension oral|polvo para solucion oral/)) return { unidad: "sobre", via: "oral" };
  if (has(/inhalador|aerosol|puff/)) return { unidad: "puff", via: "inhalatoria" };
  return { unidad: "", via: "" };
}

const controlRank = (c: CatalogProduct["control"]) => c === "Estupefaciente" ? 2 : c === "Psicotrópico" ? 1 : 0;

/** Búsqueda por palabras (todas deben coincidir, sin tildes ni mayúsculas). Primero los principios activos (genéricos), luego los productos. */
export function searchCatalog(catalog: CatalogProduct[], query: string, limit = 8): MedicationSuggestion[] {
  const tokens = normalizeKey(query).split(" ").filter(Boolean);
  if (!tokens.length || normalizeKey(query).length < 2) return [];
  const startsWord = (key: string, token: string) => key.startsWith(token) || key.includes(` ${token}`);
  const hits = catalog.filter(p => tokens.every(t => p.key.includes(t)));
  const generics = new Map<string, { label: string; control: number; count: number; sample: string; score: number }>();
  const products: { p: CatalogProduct; score: number }[] = [];
  for (const p of hits) {
    const score = tokens.reduce((s, t) => s + (p.key.startsWith(t) ? 3 : startsWord(p.key, t) ? 2 : 0), 0);
    products.push({ p, score });
    if (!p.principioActivo) continue;
    const ing = normalizeKey(p.principioActivo.replace(/\/\//g, " "));
    if (!tokens.every(t => ing.includes(t))) continue;
    const cur = generics.get(p.principioActivo);
    const gscore = tokens.reduce((s, t) => s + (ing.startsWith(t) ? 3 : startsWord(ing, t) ? 2 : 0), 0);
    if (cur) { cur.count++; cur.control = Math.max(cur.control, controlRank(p.control)); }
    else generics.set(p.principioActivo, { label: prettyIngredient(p.principioActivo), control: controlRank(p.control), count: 1, sample: p.nombre, score: gscore });
  }
  const controlOf = (rank: number): CatalogProduct["control"] => rank === 2 ? "Estupefaciente" : rank === 1 ? "Psicotrópico" : "";
  const gen: MedicationSuggestion[] = [...generics.entries()]
    .sort((a, b) => b[1].score - a[1].score || b[1].count - a[1].count || a[1].label.localeCompare(b[1].label, "es")).slice(0, 3)
    .map(([, g]) => ({ kind: "generico", label: g.label, nombre: g.label, detalle: `Principio activo · ${g.count} ${g.count === 1 ? "producto registrado" : "productos registrados"}`, control: controlOf(g.control), productos: g.count, forma: formFromName(g.sample) }));
  const prod: MedicationSuggestion[] = products
    .sort((a, b) => b.score - a.score || a.p.nombre.length - b.p.nombre.length || a.p.nombre.localeCompare(b.p.nombre, "es")).slice(0, limit - gen.length)
    .map(({ p }) => ({ kind: "producto", label: prettyName(p.nombre), nombre: prettyName(p.nombre), detalle: p.principioActivo ? prettyIngredient(p.principioActivo) : "Sin principio activo informado", control: p.control, registro: p.registro, forma: formFromName(p.nombre) }));
  return [...gen, ...prod];
}

/** Aviso legal para fármacos de control. No reemplaza la receta retenida/cheque que exige la normativa. */
export function controlNotice(control: CatalogProduct["control"]): string {
  if (control === "Estupefaciente") return "Estupefaciente: requiere receta cheque especial; esta receta simple no la reemplaza.";
  if (control === "Psicotrópico") return "Psicotrópico: requiere receta retenida; esta receta simple no la reemplaza.";
  return "";
}
