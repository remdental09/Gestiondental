// Cron Trigger entry (see "triggers" in wrangler.cloudflare.jsonc). Times are UTC.
import { syncCalendarFromIcs, type CalendarSyncEnv } from "./calendar-sync";
import { runJob, type HealthDb } from "@/lib/cron-health";

export const CALENDAR_CRON = "0 11,16,21 * * *"; // 08/13/18 Chile (UTC-3)
export const BACKUP_CRON = "*/10 2 * * *"; // 23:00-23:50 Chile (UTC-3), a few fichas per run
// Revisión cada hora: lo pendiente (p. ej. una cuenta adicional recién conectada) no espera hasta la noche.
export const HOURLY_BACKUP_CRON = "20 * * * *";
// Respaldo automático en Google Drive en su propia invocación (cada 20 minutos): así no comparte con las demás tareas
// el tope de 1.000 consultas a D1 por invocación (incidente 22/23-11: el respaldo moría sin dejar constancia).
export const DRIVE_BACKUP_CRON = "10,30,50 * * * *";
// Cada 15 minutos: se leen los calendarios y, si la agenda cambió, se avisa al técnico en el momento.
export const AGENDA_CHANGES_CRON = "*/15 * * * *";

export async function runScheduled(cron: string, env: CalendarSyncEnv) {
  const db = env.DB as unknown as HealthDb;
  // Cada tarea queda registrada en cron_health (última ejecución, éxito y error) y en los logs del Worker.
  const job = <T,>(name: string, task: () => Promise<T>) => runJob(db, name, task);
  if (cron === CALENDAR_CRON) {
    const { syncGoogleCalendars } = await import("./drive-oauth");
    console.log("google-calendars", JSON.stringify(await job("google-calendars", () => syncGoogleCalendars())));
    const result = await job("calendar-sync", () => syncCalendarFromIcs(env));
    console.log("calendar-sync", JSON.stringify(result));
    // Vigilante diario de respaldos: solo en la pasada de las 08:00 de Chile (11:00 UTC), sin cron adicional.
    if (new Date().getUTCHours() === 11) {
      const { runBackupWatchdog } = await import("./backup-watchdog");
      console.log("backup-watchdog", JSON.stringify(await job("backup-watchdog", () => runBackupWatchdog(env as unknown as Parameters<typeof runBackupWatchdog>[0]))));
    }
    return result;
  }
  if (cron === AGENDA_CHANGES_CRON) {
    const { syncGoogleCalendars, syncAppEventsFromGoogle, processPendingWrites } = await import("./drive-oauth");
    // Primero se reintenta lo que no se pudo escribir en Google (cola «pendiente de sincronizar»).
    console.log("google-pending", JSON.stringify(await job("google-pending", () => processPendingWrites())));
    // Ida y vuelta: lo que se movió o borró directo en Google Calendar vuelve a la app (citas y próximos controles).
    console.log("google-two-way", JSON.stringify(await job("google-two-way", () => syncAppEventsFromGoogle())));
    console.log("google-calendars", JSON.stringify(await job("google-calendars", () => syncGoogleCalendars())));
    const { runAgendaChangeAlerts } = await import("./agenda-digest");
    const result = await job("agenda-changes", () => runAgendaChangeAlerts());
    console.log("agenda-changes", JSON.stringify(result));
    return result;
  }
  if (cron === BACKUP_CRON || cron === HOURLY_BACKUP_CRON) {
    // Los calendarios de cada profesional también se refrescan cada hora (una lectura por calendario).
    if (cron === HOURLY_BACKUP_CRON) {
      const { syncGoogleCalendars } = await import("./drive-oauth");
      console.log("google-calendars", JSON.stringify(await job("google-calendars", () => syncGoogleCalendars())));
    }
    // Recordatorios de citas por correo: solo para quienes los activaron, desde su hora elegida (hora de Chile).
    if (cron === HOURLY_BACKUP_CRON) {
      const { runReminderCycle } = await import("./appointment-mail");
      console.log("appointment-reminders", JSON.stringify(await job("appointment-reminders", () => runReminderCycle())));
    }
    // Agenda semanal por correo (técnico/TONS): una vez al día, solo para quienes la activaron.
    if (cron === HOURLY_BACKUP_CRON) {
      const { runAgendaDigests } = await import("./agenda-digest");
      console.log("agenda-digest", JSON.stringify(await job("agenda-digest", () => runAgendaDigests())));
    }
    // Revisión posterior de las evoluciones recientes (IA): unas pocas por hora, para que lo pendiente no espere a que alguien abra la app.
    if (cron === HOURLY_BACKUP_CRON) {
      const { runNoteAudits } = await import("./audit-notes");
      console.log("note-audits", JSON.stringify(await job("note-audits", () => runNoteAudits())));
    }
    // Respaldo nocturno a un bucket R2 separado: copia de D1 (una vez al día) e imágenes nuevas por tramos.
    if (cron === BACKUP_CRON) {
      const { runNightlyBackup } = await import("@/lib/nightly-backup");
      console.log("nightly-backup", JSON.stringify(await job("nightly-backup", () => runNightlyBackup(env as unknown as Parameters<typeof runNightlyBackup>[0]))));
    }
    return null;
  }
  if (cron === DRIVE_BACKUP_CRON) {
    const { runScheduledDriveBackup } = await import("./drive-oauth");
    const result = await job("drive-backup", () => runScheduledDriveBackup());
    console.log("drive-backup", JSON.stringify(result));
    return result;
  }
  console.warn("cron sin tarea", cron);
  return null;
}
