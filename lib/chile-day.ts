/**
 * Día calendario en Chile (AAAA-MM-DD) de un instante ISO. Un registro hecho a las 21:30 en Chile
 * ya es el día siguiente en UTC: cortar el texto ISO mostraría la fecha equivocada.
 */
export function chileDay(iso: string): string {
  if (!iso) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
