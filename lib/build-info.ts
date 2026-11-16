declare const __BUILD_TIME__: string | undefined;

/** Momento (ISO) en que se compiló esta versión de la aplicación; vacío si no se conoce (por ejemplo en pruebas). */
export const BUILD_TIME: string = typeof __BUILD_TIME__ === "string" ? __BUILD_TIME__ : "";

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];

/** «16 nov 2026» y «15:12», en hora de Chile, para mostrar cuándo se actualizó la aplicación. */
export function buildStamp(iso: string): { day: string; time: string } | null {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(date).map(part => [part.type, part.value]));
  return { day: `${Number(parts.day)} ${MONTHS[Number(parts.month) - 1]} ${parts.year}`, time: `${parts.hour}:${parts.minute}` };
}
