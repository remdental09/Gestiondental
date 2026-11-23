// Vigilante diario de respaldos (ver lib/backup-watchdog.ts). Lo llama el cron de las 08:00 de Chile.
import { evaluateBackups, buildAlertMail, summarizeFindings, type Finding, type WatchJob, type WatchOwner } from "@/lib/backup-watchdog";
import type { BackupBucket } from "@/lib/nightly-backup";

type Stmt = { bind(...values: unknown[]): { all<T>(): Promise<{ results: T[] }>; first<T>(): Promise<T | null> } };
type Db = { prepare(sql: string): Stmt };
export type WatchdogEnv = { DB: unknown; BACKUP_BUCKET?: BackupBucket; CLINIC_OWNER_ID?: string };

const chileDay = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

/** Lee solo estado de los respaldos (nunca contenido clínico) y devuelve los hallazgos. */
export async function collectFindings(env: WatchdogEnv, now = new Date()): Promise<{ findings: Finding[]; ownerIds: Map<string, string> }> {
  const db = env.DB as Db;
  const since = new Date(now.getTime() - 24 * 3_600_000).toISOString();
  const jobs = await db.prepare("SELECT job, last_run_at, last_ok_at, last_error_at, last_error FROM cron_health WHERE job IN ('drive-backup','nightly-backup')").bind().all<WatchJob>().then(r => r.results).catch(() => [] as WatchJob[]);
  const connections = await db.prepare("SELECT owner_id, google_email, connected_at FROM google_drive_connections ORDER BY owner_id").bind().all<{ owner_id: string; google_email: string; connected_at: string }>().then(r => r.results).catch(() => []);
  const ownerIds = new Map<string, string>();
  const owners: WatchOwner[] = [];
  for (const c of connections) {
    ownerIds.set(c.google_email, c.owner_id);
    const beat = await db.prepare("SELECT ran_at FROM backup_heartbeat WHERE owner_id = ?").bind(c.owner_id).first<{ ran_at: string }>().catch(() => null);
    const last = await db.prepare("SELECT ok, ran_at, detail FROM backup_runs WHERE owner_id = ? ORDER BY id DESC LIMIT 1").bind(c.owner_id).first<{ ok: number; ran_at: string; detail: string }>().catch(() => null);
    const fails = await db.prepare("SELECT count(*) n FROM backup_runs WHERE owner_id = ? AND ok = 0 AND ran_at > ?").bind(c.owner_id, since).first<{ n: number }>().catch(() => null);
    const never = await db.prepare("SELECT count(*) n FROM patients p WHERE p.owner_id = ? AND NOT EXISTS (SELECT 1 FROM drive_backups b WHERE b.patient_id = p.id)").bind(c.owner_id).first<{ n: number }>().catch(() => null);
    owners.push({
      email: c.google_email, connectedAt: c.connected_at, heartbeatAt: beat?.ran_at ?? null,
      lastRun: last ? { ok: last.ok === 1, ranAt: last.ran_at, detail: last.detail } : null,
      failures24h: Number(fails?.n ?? 0), neverBackedUp: Number(never?.n ?? 0),
    });
  }
  let nightly: { today: boolean; yesterday: boolean } | null = null;
  if (env.BACKUP_BUCKET) {
    const yesterday = new Date(now.getTime() - 24 * 3_600_000);
    nightly = {
      today: Boolean(await env.BACKUP_BUCKET.head(`d1/${chileDay(now)}/manifest.json`).catch(() => null)),
      yesterday: Boolean(await env.BACKUP_BUCKET.head(`d1/${chileDay(yesterday)}/manifest.json`).catch(() => null)),
    };
  }
  return { findings: evaluateBackups({ now, jobs, owners, nightly }), ownerIds };
}

/**
 * Revisa los respaldos una vez al día. Con errores lanza (queda en «Tareas automáticas con errores» de Configuración)
 * y, si hay una cuenta de correo conectada, avisa por correo al titular. Sin problemas no envía nada.
 */
export async function runBackupWatchdog(env: WatchdogEnv, now = new Date()) {
  const { findings, ownerIds } = await collectFindings(env, now);
  const day = chileDay(now);
  const errors = findings.filter(f => f.level === "error");
  let emailed = 0;
  if (findings.length) {
    const { getSender } = await import("@/app/appointment-mail-db");
    const { sendMailWithSender } = await import("@/app/drive-oauth");
    const { buildRawMessage } = await import("@/lib/appointment-mail");
    // Los hallazgos de una cuenta van a esa cuenta; los del sistema (tareas, bucket) al titular.
    const titular = (env.CLINIC_OWNER_ID ?? "").trim();
    const targets = new Set<string>([...ownerIds.values()]);
    if (titular) targets.add(titular);
    for (const ownerId of targets) {
      const mine = findings.filter(f => (f.email ? ownerIds.get(f.email) === ownerId : ownerId === titular || !titular));
      if (!mine.length) continue;
      try {
        const sender = await getSender(ownerId);
        if (!sender) continue;
        await sendMailWithSender(sender, buildRawMessage({ from: sender.google_email, to: sender.google_email, replyTo: sender.google_email, ...buildAlertMail(mine, day) }));
        emailed++;
      } catch (error) { console.warn("backup-watchdog-correo", error instanceof Error ? error.message.slice(0, 120) : "error"); }
    }
  }
  console.log("backup-watchdog", JSON.stringify({ hallazgos: findings.length, errores: errors.length, correos: emailed }));
  if (errors.length) throw new Error(summarizeFindings(errors));
  return { ok: true, avisos: findings.length - errors.length, correos: emailed };
}
