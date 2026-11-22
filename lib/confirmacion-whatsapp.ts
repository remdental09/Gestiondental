/**
 * Confirmar la cita por WhatsApp desde la agenda por box (un toque) y porcentaje de confirmación del día.
 * Lógica pura, sin red: la app arma el mensaje y abre el chat; la persona lo envía desde su teléfono.
 * Nunca se envía nada solo y el mensaje no lleva datos clínicos (solo nombre de pila, día, hora y clínica).
 */
import { baseAttendance, type AttendanceStatus } from "./dashboard.ts";
import { waLink } from "./appointment-cycle.ts";
import { whatsappNumber } from "./agenda-box.ts";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/** «martes 24 de noviembre» para un día YYYY-MM-DD (sin depender de la zona horaria del equipo). */
export function longDayLabel(day: string): string {
  if (!DAY.test(day)) return day;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("es-CL", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).formatToParts(new Date(day + "T12:00:00Z")).map(part => [part.type, part.value]));
  return `${parts.weekday} ${parts.day} de ${parts.month}`;
}

/** Mensaje listo para enviar: pide responder para confirmar. Solo nombre de pila, día, hora y clínica. */
export function confirmationText(input: { patientName: string; day: string; start: string; clinicName?: string }): string {
  const first = input.patientName.trim().split(/\s+/)[0] ?? "";
  const clinic = input.clinicName?.trim();
  const hour = CLOCK.test(input.start) ? input.start : input.start.trim();
  return `Hola${first ? " " + first : ""}, le escribimos${clinic ? " de " + clinic : ""} para recordarle su cita el ${longDayLabel(input.day)} a las ${hour}. ¿Nos confirma su asistencia? Si no puede venir, avísenos para liberar la hora. ¡Gracias!`;
}

/** Enlace de WhatsApp con el mensaje armado; null si el paciente no tiene un celular chileno válido. */
export function confirmationLink(phone: string | null | undefined, input: { patientName: string; day: string; start: string; clinicName?: string }): string | null {
  const number = whatsappNumber(phone);
  return number ? waLink(number, confirmationText(input)) : null;
}

/** Estado al que pasa la cita cuando se pide confirmar por WhatsApp (null = no cambia: ya estaba avisada, confirmada o cerrada). */
export function statusAfterAsking(status: AttendanceStatus): AttendanceStatus | null {
  return status === "agendada" ? "notificada_whatsapp" : null;
}

/** Se puede marcar «Ya confirmó» mientras la cita siga pendiente de confirmar. */
export const canMarkConfirmed = (status: AttendanceStatus) => status === "agendada" || status === "notificada_whatsapp" || status === "notificada_email";

const NOT_COUNTED = new Set<AttendanceStatus>(["cancelada", "reagendada", "inasistida"]);

export type ConfirmationSummary = {
  /** Citas del día que cuentan (sin canceladas, reagendadas ni inasistidas). */
  total: number;
  /** Ya confirmadas, o que ya llegaron / se atendieron (confirmaron de hecho). */
  confirmed: number;
  /** Avisadas por WhatsApp o correo y todavía sin respuesta. */
  waiting: number;
  /** Sin avisar aún. */
  unnotified: number;
  /** Confirmadas / total, entero 0–100; null si no hay citas. */
  percent: number | null;
};

/** Cifras de confirmación del día para el encabezado de la agenda. */
export function confirmationSummary(appts: { status: AttendanceStatus }[]): ConfirmationSummary {
  const counted = appts.filter(a => !NOT_COUNTED.has(a.status));
  let confirmed = 0, waiting = 0, unnotified = 0;
  for (const { status } of counted) {
    const base = baseAttendance(status);
    if (base === "confirmada" || base === "atendida") confirmed++;
    else if (status === "notificada_whatsapp" || status === "notificada_email") waiting++;
    else unnotified++;
  }
  return { total: counted.length, confirmed, waiting, unnotified, percent: counted.length ? Math.round((confirmed / counted.length) * 100) : null };
}
