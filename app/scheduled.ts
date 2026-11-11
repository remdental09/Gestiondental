// Cron Trigger entry (see "triggers" in wrangler.cloudflare.jsonc). Times are UTC.
import { syncCalendarFromIcs, type CalendarSyncEnv } from "./calendar-sync";

export const CALENDAR_CRON = "0 11,16,21 * * *"; // 08/13/18 Chile (UTC-3)
export const BACKUP_CRON = "*/10 2 * * *"; // 23:00-23:50 Chile (UTC-3), a few fichas per run
// Revisión cada hora: lo pendiente (p. ej. una cuenta adicional recién conectada) no espera hasta la noche.
export const HOURLY_BACKUP_CRON = "20 * * * *";

export async function runScheduled(cron: string, env: CalendarSyncEnv) {
  if (cron === CALENDAR_CRON) {
    const { syncGoogleCalendars } = await import("./drive-oauth");
    console.log("google-calendars", JSON.stringify(await syncGoogleCalendars().catch(error => [{ ok: false, detail: String(error) }])));
    const result = await syncCalendarFromIcs(env);
    console.log("calendar-sync", JSON.stringify(result));
    return result;
  }
  if (cron === BACKUP_CRON || cron === HOURLY_BACKUP_CRON) {
    // Los calendarios de cada profesional también se refrescan cada hora (una lectura por calendario).
    if (cron === HOURLY_BACKUP_CRON) {
      const { syncGoogleCalendars } = await import("./drive-oauth");
      console.log("google-calendars", JSON.stringify(await syncGoogleCalendars().catch(error => [{ ok: false, detail: String(error) }])));
    }
    // Recordatorios de citas por correo: solo para quienes los activaron, desde su hora elegida (hora de Chile).
    if (cron === HOURLY_BACKUP_CRON) {
      const { runReminderCycle } = await import("./appointment-mail");
      console.log("appointment-reminders", JSON.stringify(await runReminderCycle().catch(error => [{ ok: false, detail: String(error) }])));
    }
    // Revisión posterior de las evoluciones recientes (IA): unas pocas por hora, para que lo pendiente no espere a que alguien abra la app.
    if (cron === HOURLY_BACKUP_CRON) {
      const { runNoteAudits } = await import("./audit-notes");
      console.log("note-audits", JSON.stringify(await runNoteAudits().catch(error => [{ ok: false, detail: String(error) }])));
    }
    const { runScheduledDriveBackup } = await import("./drive-oauth");
    const result = await runScheduledDriveBackup();
    console.log("drive-backup", JSON.stringify(result));
    return result;
  }
  console.warn("cron sin tarea", cron);
  return null;
}
