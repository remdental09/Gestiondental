/**
 * Panel del desarrollador: quiénes entraron a SpeakDent y quiénes completaron su registro profesional.
 * Solo lo ven los correos de DEVELOPER_EMAILS (por defecto, remdental09@gmail.com).
 */
export const DEFAULT_DEVELOPER_EMAILS = "remdental09@gmail.com";

export function developerEmails(raw?: string): Set<string> {
  const source = raw?.trim() ? raw : DEFAULT_DEVELOPER_EMAILS;
  return new Set(source.split(/[,;\s]+/).map(e => e.trim().toLowerCase()).filter(e => e.includes("@")));
}

export function isDeveloperEmail(email: string | null | undefined, raw?: string): boolean {
  const clean = (email ?? "").trim().toLowerCase();
  return Boolean(clean) && developerEmails(raw).has(clean);
}

export type AppUserRow = { owner_id: string; email: string; google_name: string | null; first_seen: string; last_seen: string; visits: number };
export type ProfileRow = { owner_id: string; email: string; first_name: string; last_name: string; rut: string; specialty: string; clinic_name: string | null; extra_titles: string | null; created_at: string };
export type CountRow = { owner_id: string; patients?: number; notes?: number; last_note?: string | null };

export type DentistRow = {
  key: string;
  email: string;
  googleName: string;
  name: string;
  rut: string;
  specialty: string;
  clinic: string;
  extraTitles: string;
  registered: boolean;
  registeredAt: string | null;
  firstSeen: string | null;
  lastSeen: string | null;
  visits: number;
  patients: number;
  notes: number;
  lastNote: string | null;
};

const earliest = (...values: (string | null | undefined)[]) => values.filter((v): v is string => Boolean(v)).sort()[0] ?? null;

/** Junta ingresos, registros y conteos por owner_id. No expone el owner_id: la clave es un índice. */
export function buildDentistRows(users: AppUserRow[], profiles: ProfileRow[], patientCounts: CountRow[], noteCounts: CountRow[]): DentistRow[] {
  const byOwner = new Map<string, { user?: AppUserRow; profile?: ProfileRow }>();
  for (const user of users) byOwner.set(user.owner_id, { ...byOwner.get(user.owner_id), user });
  for (const profile of profiles) byOwner.set(profile.owner_id, { ...byOwner.get(profile.owner_id), profile });
  const patientsBy = new Map(patientCounts.map(c => [c.owner_id, Number(c.patients) || 0]));
  const notesBy = new Map(noteCounts.map(c => [c.owner_id, c]));
  const rows = [...byOwner.entries()].map(([ownerId, { user, profile }]) => {
    const notes = notesBy.get(ownerId);
    return {
      key: "",
      email: (profile?.email || user?.email || "").toLowerCase(),
      googleName: user?.google_name?.trim() || "",
      name: profile ? `Dr(a). ${profile.first_name} ${profile.last_name}` : "",
      rut: profile?.rut ?? "",
      specialty: profile?.specialty ?? "",
      clinic: profile?.clinic_name?.trim() || "",
      extraTitles: profile?.extra_titles?.trim() || "",
      registered: Boolean(profile),
      registeredAt: profile?.created_at ?? null,
      firstSeen: earliest(user?.first_seen, profile?.created_at),
      lastSeen: user?.last_seen ?? null,
      visits: Number(user?.visits) || 0,
      patients: patientsBy.get(ownerId) ?? 0,
      notes: Number(notes?.notes) || 0,
      lastNote: notes?.last_note ?? null,
    } satisfies DentistRow;
  });
  rows.sort((a, b) => (b.lastSeen ?? b.firstSeen ?? "").localeCompare(a.lastSeen ?? a.firstSeen ?? "") || a.email.localeCompare(b.email));
  return rows.map((row, index) => ({ ...row, key: String(index + 1) }));
}

export type DashboardSummary = { total: number; registered: number; pending: number; activeLast7Days: number; newLast30Days: number; patients: number };

export function dashboardSummary(rows: DentistRow[], now = new Date()): DashboardSummary {
  const since = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  const week = since(7), month = since(30);
  return {
    total: rows.length,
    registered: rows.filter(r => r.registered).length,
    pending: rows.filter(r => !r.registered).length,
    activeLast7Days: rows.filter(r => (r.lastSeen ?? "") >= week).length,
    newLast30Days: rows.filter(r => (r.firstSeen ?? "") >= month).length,
    patients: rows.reduce((sum, r) => sum + r.patients, 0),
  };
}

const csvCell = (value: string | number | boolean | null) => {
  const text = value === null ? "" : String(value);
  return /[",;\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function dentistsCsv(rows: DentistRow[]): string {
  const header = ["Nombre", "Correo", "Nombre en Google", "RUT", "Especialidad", "Otros títulos", "Clínica", "Registro completo", "Primer ingreso", "Último ingreso", "Veces que abrió la app", "Pacientes", "Evoluciones", "Última evolución"];
  const lines = rows.map(r => [r.name, r.email, r.googleName, r.rut, r.specialty, r.extraTitles, r.clinic, r.registered ? "Sí" : "No", r.firstSeen, r.lastSeen, r.visits, r.patients, r.notes, r.lastNote].map(csvCell).join(";"));
  return "﻿" + [header.join(";"), ...lines].join("\n");
}
