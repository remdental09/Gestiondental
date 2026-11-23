/**
 * Vigilante diario de los respaldos. Revisa, sin tocar datos clínicos, que:
 *  - la tarea de respaldo en Drive siga corriendo y sin errores;
 *  - cada cuenta de Drive conectada tenga una revisión reciente y su autorización vigente;
 *  - la copia nocturna de D1 e imágenes (bucket R2 separado) exista para hoy o ayer.
 * Esta parte es pura (recibe los datos ya leídos) para poder probarla; app/backup-watchdog.ts lee D1/R2 y avisa.
 */
export type WatchJob = { job: string; last_run_at: string; last_ok_at: string | null; last_error_at: string | null; last_error: string | null };
export type WatchOwner = {
  email: string;
  connectedAt: string;
  heartbeatAt: string | null;
  lastRun: { ok: boolean; ranAt: string; detail: string } | null;
  failures24h: number;
  neverBackedUp: number;
};
export type WatchInput = {
  now: Date;
  jobs: WatchJob[];
  owners: WatchOwner[];
  /** null = el bucket de respaldo no está configurado. */
  nightly: { today: boolean; yesterday: boolean } | null;
};
export type Finding = { level: "error" | "warn"; code: string; message: string; email?: string };

const HOUR = 3_600_000;
const needsReconnect = (text: string) => /invalid_grant|venció|fue rechazada/i.test(text);
const age = (iso: string | null, now: Date) => (iso ? now.getTime() - new Date(iso).getTime() : Number.POSITIVE_INFINITY);

export function evaluateBackups(input: WatchInput): Finding[] {
  const { now, jobs, owners, nightly } = input;
  const out: Finding[] = [];

  const drive = jobs.find(j => j.job === "drive-backup");
  if (!drive) out.push({ level: "error", code: "drive-job-missing", message: "La tarea de respaldo en Drive nunca se ha ejecutado." });
  else {
    if (age(drive.last_run_at, now) > 2 * HOUR) out.push({ level: "error", code: "drive-job-stale", message: "La tarea de respaldo en Drive no se ejecuta hace más de 2 horas." });
    if (drive.last_error_at && (!drive.last_ok_at || drive.last_error_at > drive.last_ok_at)) out.push({ level: "error", code: "drive-job-failing", message: "La tarea de respaldo en Drive está fallando" + (drive.last_error ? ": " + drive.last_error : ".") });
  }

  const night = jobs.find(j => j.job === "nightly-backup");
  if (nightly === null) out.push({ level: "warn", code: "nightly-unconfigured", message: "No hay bucket de respaldo nocturno configurado (D1 e imágenes)." });
  else {
    if (!night || age(night.last_ok_at, now) > 36 * HOUR) out.push({ level: "error", code: "nightly-stale", message: "El respaldo nocturno (D1 e imágenes) no termina bien hace más de 36 horas." });
    if (!nightly.today && !nightly.yesterday) out.push({ level: "error", code: "nightly-missing-dump", message: "No existe la copia de D1 de hoy ni de ayer en el bucket de respaldo." });
  }

  for (const owner of owners) {
    const base = { email: owner.email };
    if (age(owner.heartbeatAt, now) > 3 * HOUR) out.push({ ...base, level: "error", code: "owner-heartbeat-stale", message: `La cuenta ${owner.email} no tiene revisión automática en las últimas 3 horas.` });
    if (owner.lastRun && !owner.lastRun.ok && needsReconnect(owner.lastRun.detail)) out.push({ ...base, level: "error", code: "owner-reconnect", message: `La autorización de Google de ${owner.email} venció o fue revocada: hay que reconectarla.` });
    if (owner.failures24h >= 5) out.push({ ...base, level: "warn", code: "owner-many-failures", message: `${owner.email}: ${owner.failures24h} fichas fallaron en las últimas 24 horas.` });
    if (owner.neverBackedUp > 0 && age(owner.connectedAt, now) > 48 * HOUR) out.push({ ...base, level: "warn", code: "owner-backlog", message: `${owner.email}: ${owner.neverBackedUp} fichas aún sin respaldo en Drive tras más de 2 días conectada.` });
  }
  return out;
}

export function summarizeFindings(findings: Finding[]): string {
  if (!findings.length) return "Todos los respaldos al día.";
  return findings.map(f => (f.level === "error" ? "ERROR: " : "Aviso: ") + f.message).join(" ");
}

export function buildAlertMail(findings: Finding[], day: string): { subject: string; text: string; html: string } {
  const errors = findings.filter(f => f.level === "error").length;
  const subject = `${errors ? "Respaldos con problemas" : "Avisos de respaldos"} · Gestión Dental · ${day}`;
  const lines = findings.map(f => `- ${f.level === "error" ? "Error" : "Aviso"}: ${f.message}`);
  const text = ["El vigilante diario de respaldos encontró lo siguiente:", "", ...lines, "", "Tus fichas siguen guardadas en Gestión Dental. Revisa Configuración → Respaldo en Google Drive."].join("\n");
  const esc = (s: string) => s.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
  const html = `<p>El vigilante diario de respaldos encontró lo siguiente:</p><ul>${findings.map(f => `<li><strong>${f.level === "error" ? "Error" : "Aviso"}:</strong> ${esc(f.message)}</li>`).join("")}</ul><p>Tus fichas siguen guardadas en Gestión Dental. Revisa Configuración → Respaldo en Google Drive.</p>`;
  return { subject, text, html };
}
