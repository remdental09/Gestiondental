import type { evolutions } from "@/db/schema";

/** Fecha clínica en español, para mostrar en una evolución (compartido entre /api/clinical y /api/implantes). */
export const displayDate = (value: string) => {
  if (!value) return "Fecha de atención no consignada";
  const [y, m, d] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
};

/** Datos de anulación de una evolución (solo si está anulada o reemplaza a otra). */
export function annulView(n: typeof evolutions.$inferSelect) {
  return {
    status: n.status === "anulada" ? "anulada" as const : "vigente" as const,
    ...(n.status === "anulada" ? { annulledAt: n.annulledAt, annulledBy: n.annulledBy, annulReason: n.annulReason } : {}),
    ...(n.replacesId ? { replacesId: n.replacesId } : {}),
  };
}
