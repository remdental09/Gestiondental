/**
 * Estado de navegación ⇄ URL (`/?paciente=<id>&seccion=…`), para que el botón Atrás de Safari funcione.
 * Sin ids fijos: el id solo se resuelve contra las fichas que la API devuelve para la cuenta que inició sesión.
 */
export type AppView = { section: string; patientId: number; tab: string };
export type ParsedAppUrl = { section: string; patientId: number | null; tab: string; invalidPatient: boolean };

export const FICHA = "Ficha clínica";
const SECTION_SLUG: Record<string, string> = { Resumen: "resumen", Pacientes: "pacientes", Agenda: "agenda", Presupuestos: "presupuestos" };
const TAB_SLUG: Record<string, string> = { evoluciones: "evolucion", odontograma: "odontograma", periodontograma: "periodontograma", imagenes: "imagenes", presupuestos: "presupuesto" };
const fromSlug = <T extends Record<string, string>>(map: T, slug: string) => Object.keys(map).find((key) => map[key] === slug) ?? null;

export function buildAppUrl(view: AppView): string {
  if (view.section === FICHA && view.patientId > 0) {
    const tab = TAB_SLUG[view.tab] ?? "evolucion";
    return tab === "evolucion" ? `/?paciente=${view.patientId}` : `/?paciente=${view.patientId}&seccion=${tab}`;
  }
  if (view.section === "Agenda" && view.patientId > 0) return `/?seccion=agenda`;
  const slug = SECTION_SLUG[view.section];
  return slug ? `/?seccion=${slug}` : "/";
}

export function parseAppUrl(search: string): ParsedAppUrl {
  const params = new URLSearchParams(search);
  const rawPatient = params.get("paciente");
  const seccion = (params.get("seccion") ?? "").trim().toLowerCase();
  if (rawPatient !== null) {
    const id = /^\d{1,12}$/.test(rawPatient.trim()) ? Number(rawPatient.trim()) : NaN;
    if (!Number.isSafeInteger(id) || id <= 0) return { section: "Pacientes", patientId: null, tab: "evoluciones", invalidPatient: true };
    if (seccion === "agenda") return { section: "Agenda", patientId: id, tab: "evoluciones", invalidPatient: false };
    return { section: FICHA, patientId: id, tab: fromSlug(TAB_SLUG, seccion) ?? "evoluciones", invalidPatient: false };
  }
  const section = fromSlug(SECTION_SLUG, seccion);
  if (section) return { section, patientId: null, tab: "evoluciones", invalidPatient: false };
  // Una pestaña de ficha sin paciente: se muestra la lista.
  if (fromSlug(TAB_SLUG, seccion) || seccion === "ficha") return { section: "Pacientes", patientId: null, tab: fromSlug(TAB_SLUG, seccion) ?? "evoluciones", invalidPatient: false };
  return { section: "Inicio", patientId: null, tab: "evoluciones", invalidPatient: false };
}

/** Aplica una URL a las fichas cargadas: un id que no está en la cuenta va a la lista con aviso. */
export function resolveAppUrl(parsed: ParsedAppUrl, knownIds: ReadonlySet<number>, fallbackId: number): AppView & { notFound: boolean } {
  if (parsed.invalidPatient) return { section: "Pacientes", patientId: fallbackId, tab: "evoluciones", notFound: true };
  if (parsed.patientId !== null && !knownIds.has(parsed.patientId)) return { section: "Pacientes", patientId: fallbackId, tab: "evoluciones", notFound: true };
  return { section: parsed.section, patientId: parsed.patientId ?? fallbackId, tab: parsed.tab, notFound: false };
}
