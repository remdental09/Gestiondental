/**
 * Próximos controles: fecha a partir de lo dictado («control en 6 meses», «citar en 2 semanas», «el 15 de diciembre»)
 * y agrupación para la lista (vencidos, esta semana, este mes). Lógica pura, con fechas AAAA-MM-DD de Chile.
 */
export type ControlStatus = "pendiente" | "contactado" | "agendado" | "realizado" | "descartado";
export const CONTROL_STATUSES: Array<{ key: ControlStatus; label: string }> = [
  { key: "pendiente", label: "Pendiente" }, { key: "contactado", label: "Contactado" }, { key: "agendado", label: "Agendado" },
  { key: "realizado", label: "Realizado" }, { key: "descartado", label: "Descartado" },
];
export const isControlStatus = (value: unknown): value is ControlStatus => CONTROL_STATUSES.some(status => status.key === value);
export type ControlSuggestion = { dueOn: string; said: string; reason: string };

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const NUM: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, quince: 15, dieciocho: 18, veinte: 20, treinta: 30 };
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const TRIGGER = /\b(control(ar|es)?|recontrol|citar|cita(r)?|recitar|volver|vuelve|regres\w*|revision|reevalua\w*|evaluar|mantencion|seguimiento|ver(la|lo) de nuevo)\b/;

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const parts = (day: string) => day.split("-").map(Number) as [number, number, number];

/** Suma días a una fecha AAAA-MM-DD. */
export function addDays(day: string, days: number): string {
  const t = Date.UTC(...(([y, m, d]) => [y, m - 1, d] as const)(parts(day))) + days * 86_400_000;
  const date = new Date(t);
  return iso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}
/** Suma meses; si el día no existe (31 de febrero) queda en el último día del mes. */
export function addMonths(day: string, months: number): string {
  const [y, m, d] = parts(day);
  const total = (y * 12 + (m - 1)) + months;
  const ny = Math.floor(total / 12), nm = total % 12 + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return iso(ny, nm, Math.min(d, last));
}

/**
 * Busca en el texto una indicación de control y calcula la fecha desde `today`. Devuelve null si no hay.
 * Solo frases con una palabra de control/cita: «en 6 meses» suelto (p. ej. «dolor hace 6 meses») no cuenta.
 */
export function parseControlFromText(text: string, today: string): ControlSuggestion | null {
  for (const raw of text.split(/(?<=[.;!?\n])\s*/)) {
    const s = fold(raw);
    if (!TRIGGER.test(s)) continue;
    const said = raw.trim().replace(/[.;]+$/, "").slice(0, 160);
    const reasonMatch = s.match(/\bcontrol(?:ar)?\s+(?:de(?:l| la| los| las)?|post|para)\s+([a-zñ0-9 .,-]{3,60}?)(?=\s+(?:en|el|dentro|a los|al)\b|[,.;]|$)/);
    const purpose = raw.match(/\bpara\s+([^,.;]{3,60})/i);
    const reason = reasonMatch ? `Control ${reasonMatch[0].replace(/^control(?:ar)?\s+/, "").trim()}` : purpose ? `Control: ${purpose[1].trim()}` : "Control";
    // «al mes», «al año», «a la semana»
    const single = s.match(/\b(?:al|a la)\s+(mes|ano|semana)\b/);
    if (single) return { dueOn: single[1] === "semana" ? addDays(today, 7) : addMonths(today, single[1] === "mes" ? 1 : 12), said, reason };
    // «en 6 meses», «en dos semanas», «en un año», «en 6 meses más», «dentro de 15 días», «a los 3 meses»
    const rel = s.match(/\b(?:en|dentro de|a los|a las|a un|a una|en unos|en unas)\s+(\d{1,3}|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|dieciocho|veinte|treinta|medio)?\s*(dias?|semanas?|mes(?:es)?|anos?|ano)\b/);
    if (rel) {
      const unit = rel[2];
      let n = rel[1] === undefined ? 1 : rel[1] === "medio" ? 0.5 : /^\d+$/.test(rel[1]) ? Number(rel[1]) : NUM[rel[1]] ?? NaN;
      if (rel[1] === undefined && /\ba (un|una)\b/.test(rel[0])) n = 1;
      if (!Number.isFinite(n) || n <= 0) continue;
      const due = /^dia/.test(unit) ? addDays(today, Math.round(n)) : /^semana/.test(unit) ? addDays(today, Math.round(n * 7))
        : /^mes/.test(unit) ? addMonths(today, Math.round(n)) : addMonths(today, Math.round(n * 12));
      return { dueOn: due, said, reason };
    }
    // «el 15 de diciembre», «15 de marzo de 2027»
    const abs = s.match(/\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+(?:de|del)\s+(\d{4}))?\b/);
    if (abs) {
      const month = abs[2] === "setiembre" ? 9 : MONTHS.indexOf(abs[2]) + 1, dayN = Number(abs[1]);
      const [ty] = parts(today);
      let year = abs[3] ? Number(abs[3]) : ty;
      const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
      if (dayN < 1 || dayN > last) continue;
      let due = iso(year, month, dayN);
      if (!abs[3] && due <= today) { year += 1; due = iso(year, month, Math.min(dayN, new Date(Date.UTC(year, month, 0)).getUTCDate())); }
      return { dueOn: due, said, reason };
    }
  }
  return null;
}

export type ControlBucket = "vencido" | "semana" | "mes" | "despues";
/** Vencido (antes de hoy), esta semana (hoy a domingo), este mes (resto del mes) o después. */
export function controlBucket(dueOn: string, today: string): ControlBucket {
  if (dueOn < today) return "vencido";
  const [y, m, d] = parts(today);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
  const sunday = addDays(today, (7 - weekday) % 7);
  if (dueOn <= sunday) return "semana";
  if (dueOn.slice(0, 7) === today.slice(0, 7)) return "mes";
  return "despues";
}
/** Filtros de la lista: «este mes» incluye esta semana; vencidos solo cuenta lo que sigue abierto. */
export function controlMatches(filter: "vencidos" | "semana" | "mes" | "todos", control: { dueOn: string; status: ControlStatus }, today: string): boolean {
  if (filter === "todos") return true;
  const open = control.status !== "realizado" && control.status !== "descartado";
  const bucket = controlBucket(control.dueOn, today);
  if (filter === "vencidos") return open && bucket === "vencido";
  if (filter === "semana") return bucket === "semana";
  return bucket === "semana" || bucket === "mes";
}
/** Enlace de WhatsApp (sin envío automático): solo abre el chat con un texto sugerido. */
export function whatsappLink(phone: string, text: string): string | null {
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 9 && digits.startsWith("9")) digits = "56" + digits;
  if (digits.length === 8) digits = "569" + digits;
  if (digits.length < 10) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
