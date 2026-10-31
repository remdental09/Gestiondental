import { and, desc, eq, ne } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { ClinicalImportError, runDriveRecordImport } from "@/app/clinical-import";
import { syncInstalledImplants } from "@/app/sync-odontogram";
import { cementedCrownFromEvolution } from "@/app/crown-evidence";
import { fullNameRequiredMessage, hasFourNameParts } from "@/app/patient-identity";
import { getDb } from "@/db";
import { appointments, budgets, calendarEvents, clinicalImages, evolutions, patients, periodontalExams, toothStatuses } from "@/db/schema";
import type { OdontogramData, OdontogramSurface, SurfaceFinding } from "@/app/clinical-data";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const now = () => new Date().toISOString();
const cleanRut = (value: string) => value.toUpperCase().replace(/[^0-9K]/g, "");
const validRut = (value: string) => {
  const v = cleanRut(value), body = v.slice(0, -1), digit = v.slice(-1);
  if (!/^\d{1,9}$/.test(body) || !/^[0-9K]$/.test(digit)) return false;
  let sum = 0, m = 2;
  for (let i = body.length - 1; i >= 0; i--) { sum += Number(body[i]) * m; m = m === 7 ? 2 : m + 1; }
  const d = 11 - sum % 11;
  return (d === 11 ? "0" : d === 10 ? "K" : String(d)) === digit;
};
const dateInChile = (value = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
const displayDate = (value: string) => {
  if (!value) return "Fecha de atención no consignada";
  const [y, m, d] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
};
const error = (message: string, status = 400) => Response.json({ error: message }, { status });
const string = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
const normalizePatientName = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const validPhone = (value: string) => !value || (/^[+\d()\s.-]{7,24}$/.test(value) && value.replace(/\D/g, "").length >= 8);
const validEmail = (value: string) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const protect = async () => (await getChatGPTUser())?.userId ?? null;
// This snapshot is supplied by a private runtime secret, never committed to Git.
function calendarSnapshot(email: string, persisted: typeof calendarEvents.$inferSelect[]) {
  if (email.toLowerCase() !== "lpaulr@gmail.com") return { events: [], capturedAt: null };
  const raw = (env as unknown as Record<string, unknown>).CALENDAR_WEEK_SNAPSHOT_JSON;
  if (typeof raw !== "string") return { events: [], capturedAt: null };
  try {
    const snapshot = JSON.parse(raw) as { calendarId?: string; capturedAt?: string; events?: Array<{ eventId?: string; title?: string; startAt?: string; endAt?: string; status?: string; htmlLink?: string }> };
    if (snapshot.calendarId !== "lpaulr@gmail.com" || !Array.isArray(snapshot.events)) return { events: [], capturedAt: null };
    const stored = new Set(persisted.filter(e => e.calendarId === snapshot.calendarId).map(e => e.googleEventId));
    const events = snapshot.events.flatMap((item, index) => {
      if (!item.eventId || stored.has(item.eventId) || !item.title || item.status !== "confirmed" || !item.startAt || !item.endAt || !Number.isFinite(Date.parse(item.startAt)) || !Number.isFinite(Date.parse(item.endAt))) return [];
      return [{ id: -index - 1, title: item.title, startAt: new Date(item.startAt).toISOString(), endAt: new Date(item.endAt).toISOString(), sourceTimeZone: "America/Santiago", htmlLink: item.htmlLink || null, status: "confirmed", allDay: false, patientId: null }];
    });
    return { events, capturedAt: typeof snapshot.capturedAt === "string" ? snapshot.capturedAt : null };
  } catch { return { events: [], capturedAt: null }; }
}

const allowedTeeth = new Set([11,12,13,14,15,16,17,18,21,22,23,24,25,26,27,28,31,32,33,34,35,36,37,38,41,42,43,44,45,46,47,48,51,52,53,54,55,61,62,63,64,65,71,72,73,74,75,81,82,83,84,85]);
const odontogramWriteActions = new Set(["syncEvolutionOdontogram", "setToothStatus", "setToothMissingReason", "setToothSurface"]);
const surfaceKeys = new Set(["V","P","M","D","O"]);
const validPerioTeeth = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const perioSites = new Set(["MV","V","DV","ML","L","DL"]), gingivalSites = new Set(["V","L","D","M"]);
  for (const [key,raw] of Object.entries(value)) {
    const tooth = Number(key);
    if (!Number.isSafeInteger(tooth) || tooth < 11 || tooth > 48 || !allowedTeeth.has(tooth) || !raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const entry = raw as Record<string,unknown>;
    if (entry.sites !== undefined) {
      if (!entry.sites || typeof entry.sites !== "object" || Array.isArray(entry.sites)) return false;
      for (const [site,reading] of Object.entries(entry.sites)) {
        if (!perioSites.has(site) || !reading || typeof reading !== "object" || Array.isArray(reading)) return false;
        const r = reading as Record<string,unknown>;
        if (!(r.depth === null || (Number.isInteger(r.depth) && Number(r.depth) >= 0 && Number(r.depth) <= 20)) || !(r.margin === null || (Number.isInteger(r.margin) && Number(r.margin) >= -10 && Number(r.margin) <= 20)) || typeof r.bleeding !== "boolean" || typeof r.suppuration !== "boolean") return false;
      }
    }
    if (entry.gingivalIndex !== undefined) {
      if (!entry.gingivalIndex || typeof entry.gingivalIndex !== "object" || Array.isArray(entry.gingivalIndex)) return false;
      for (const [site,score] of Object.entries(entry.gingivalIndex)) if (!gingivalSites.has(site) || !Number.isInteger(score) || Number(score) < 0 || Number(score) > 3) return false;
    }
    if (entry.mobility !== undefined && !["","0","I","II","III"].includes(String(entry.mobility))) return false;
    if (entry.furcation !== undefined && !["","I","II","III"].includes(String(entry.furcation))) return false;
  }
  return true;
};
const normalizeOdontogram = (raw: unknown): OdontogramData => {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const teeth = source.teeth && typeof source.teeth === "object" && !Array.isArray(source.teeth) ? { ...(source.teeth as Record<number,string>) } : {};
  const surfaces = source.surfaces && typeof source.surfaces === "object" && !Array.isArray(source.surfaces) ? { ...(source.surfaces as OdontogramData["surfaces"]) } : {};
  const missingReason = source.missingReason && typeof source.missingReason === "object" && !Array.isArray(source.missingReason) ? { ...(source.missingReason as OdontogramData["missingReason"]) } : {};
  for (const [key,value] of Object.entries(source)) if (/^\d{2}$/.test(key) && typeof value === "string") teeth[Number(key)] = value;
  const crowns = source.crowns && typeof source.crowns === "object" && !Array.isArray(source.crowns) ? { ...(source.crowns as NonNullable<OdontogramData["crowns"]>) } : {};
  for (const value of Object.values(crowns)) {
    if (!value || typeof value !== "object") continue;
    if (value.foundation !== "implant" && value.foundation !== "tooth") delete value.foundation;
  }
  return { teeth, surfaces, missingReason, crowns };
};
const normalizePerio = (raw: unknown) => {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string,unknown> : {};
  return source.teeth && typeof source.teeth === "object" && !Array.isArray(source.teeth)
    ? { teeth:source.teeth, epb:source.epb, classification:source.classification }
    : { teeth:source };
};

export async function GET() {
  const viewer = await getChatGPTUser();
  const ownerId = viewer?.userId;
  if (!ownerId) return error("Inicia sesión para ver las fichas.", 401);
  try {
    const db = getDb();
    const [ps, ns, bs, as, pe, ts, imgs, ces] = await Promise.all([
      db.select().from(patients).where(eq(patients.ownerId, ownerId)).orderBy(patients.name),
      db.select().from(evolutions).where(eq(evolutions.ownerId, ownerId)).orderBy(desc(evolutions.clinicalDate), desc(evolutions.recordedAt)),
      db.select().from(budgets).where(eq(budgets.ownerId, ownerId)).orderBy(desc(budgets.id)),
      db.select().from(appointments).where(eq(appointments.ownerId, ownerId)).orderBy(appointments.day),
      db.select().from(periodontalExams).where(eq(periodontalExams.ownerId, ownerId)).orderBy(desc(periodontalExams.id)),
      db.select().from(toothStatuses).where(eq(toothStatuses.ownerId, ownerId)),
      db.select().from(clinicalImages).where(eq(clinicalImages.ownerId, ownerId)).orderBy(desc(clinicalImages.id)),
      db.select().from(calendarEvents).where(eq(calendarEvents.ownerId, ownerId)).orderBy(calendarEvents.startAt),
    ]);
    const notesByPatient = new Map<number, typeof ns>();
    for (const note of ns) {
      const patientNotes = notesByPatient.get(note.patientId);
      if (patientNotes) patientNotes.push(note);
      else notesByPatient.set(note.patientId, [note]);
    }
    const examsByPatient = new Map<number, typeof pe>();
    for (const exam of pe) {
      const patientExams = examsByPatient.get(exam.patientId);
      if (patientExams) patientExams.push(exam);
      else examsByPatient.set(exam.patientId, [exam]);
    }
    const toothStatusByPatient = new Map(ts.map(status => [status.patientId, status]));
    const snapshot = calendarSnapshot(viewer?.email || "", ces);
    const charts = Object.fromEntries(ps.map(p => {
      const saved = toothStatusByPatient.get(p.id);
      const chart = normalizeOdontogram(saved ? JSON.parse(saved.data) : {});
      for (const note of notesByPatient.get(p.id) ?? []) {
        const crown = cementedCrownFromEvolution(note.body);
        const status = chart.teeth[crown?.tooth ?? -1];
        if (crown?.material && !chart.crowns?.[crown.tooth] && ((crown.onImplant && status === "Implante") || (!crown.onImplant && status === "Corona"))) {
          chart.crowns![crown.tooth] = { material: crown.material, shade: crown.shade, source: "evolution", clinicalDate: note.clinicalDate, foundation: crown.onImplant ? "implant" : "tooth" };
        }
      }
      return [p.id, chart];
    }));
    return Response.json({
      patients: ps.map(p => ({ ...p, rut: p.rut || "" })),
      notes: ns.map(n => ({ id: n.id, patientId: n.patientId, date: displayDate(n.clinicalDate), clinicalDate: n.clinicalDate, recordedAt: n.recordedAt, title: n.title, body: n.body, sourceDocumentId: n.sourceDocumentId, backupStatus: n.backupStatus })),
      budgets: bs.map(b => ({ id: b.id, patientId: b.patientId, date: displayDate(b.createdAt.slice(0, 10)), title: b.title, status: b.status, items: JSON.parse(b.items) })),
      appointments: as.map(a => ({ id: a.id, patientId: a.patientId, day: a.day.split("-").reverse().join("-"), time: a.time, reason: a.reason })),
      calendarEvents: [...ces.filter(e => e.status !== "cancelled").map(e => ({ id: e.id, title: e.title, startAt: e.startAt, endAt: e.endAt, sourceTimeZone: e.sourceTimeZone, htmlLink: e.htmlLink, status: e.status, allDay: e.allDay, patientId: e.patientId })), ...snapshot.events],
      calendarSnapshotAt: snapshot.events.length ? snapshot.capturedAt : null,
      periodontalExams: Object.fromEntries(ps.map(p => [p.id, (examsByPatient.get(p.id) ?? []).map(x => ({ id: x.id, recordedAt: x.recordedAt, ...normalizePerio(JSON.parse(x.teeth)) }))])),
      toothStatuses: charts,
      clinicalImages: imgs.map(i => ({ id: i.id, patientId: i.patientId, url: "/api/images/" + i.id, name: i.name, kind: i.kind, note: i.note, addedAt: displayDate(i.addedAt.slice(0, 10)), size: i.size, contentType: i.contentType })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return error("No se pudo cargar la base de datos. Intenta de nuevo.", 503);
  }
}

export async function POST(request: Request) {
  const ownerId = await protect();
  if (!ownerId) return error("Inicia sesión para guardar.", 401);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return error("Origen no permitido.", 403);
  let input: Record<string, unknown>;
  try { input = await request.json(); if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error(); }
  catch { return error("Solicitud inválida."); }
  const db = getDb();
  const action = input.action, patientId = Number(input.patientId);
  try {
    if (action === "importCalendarEvents") {
      const raw = input.events;
      const calendarId = string(input.calendarId, 512);
      if (!calendarId || !Array.isArray(raw) || raw.length < 1 || raw.length > 250) return error("Lote de calendario inválido.");
      const parsed: Array<{eventId:string;title:string;startAt:string;endAt:string;htmlLink:string|null;status:string}> = [];
      const ids = new Set<string>();
      for (const item of raw) {
        if (!item || typeof item !== "object" || Array.isArray(item)) return error("Evento inválido.");
        const e = item as Record<string,unknown>;
        const eventId=string(e.eventId,512), title=string(e.title,500), start=string(e.startAt,64), end=string(e.endAt,64), link=string(e.htmlLink,2000), status=string(e.status,20)||"confirmed";
        const validTime=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
        const startDate=new Date(start), endDate=new Date(end);
        let validLink=true;
        if (link) { try { const u=new URL(link); validLink=u.protocol==="https:"&&["www.google.com","calendar.google.com"].includes(u.hostname); } catch { validLink=false; } }
        if (!eventId || ids.has(eventId) || !title || !validTime.test(start) || !validTime.test(end) || !Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime()) || startDate>=endDate || !["confirmed","cancelled"].includes(status) || !validLink) return error("Revisa ID, fechas, estado o enlace del evento.");
        ids.add(eventId);
        parsed.push({eventId,title,startAt:startDate.toISOString(),endAt:endDate.toISOString(),htmlLink:link||null,status});
      }
      const importedAt=now();
      for (const e of parsed) await db.insert(calendarEvents).values({ownerId,calendarId,googleEventId:e.eventId,title:e.title,startAt:e.startAt,endAt:e.endAt,sourceTimeZone:"America/Santiago",htmlLink:e.htmlLink,status:e.status,allDay:false,importedAt}).onConflictDoUpdate({target:[calendarEvents.ownerId,calendarEvents.calendarId,calendarEvents.googleEventId],set:{title:e.title,startAt:e.startAt,endAt:e.endAt,htmlLink:e.htmlLink,status:e.status,importedAt}});
      const saved=await db.select({id:calendarEvents.googleEventId,title:calendarEvents.title,startAt:calendarEvents.startAt,endAt:calendarEvents.endAt,status:calendarEvents.status}).from(calendarEvents).where(and(eq(calendarEvents.ownerId,ownerId),eq(calendarEvents.calendarId,calendarId)));
      if (parsed.some(e=>!saved.some(s=>s.id===e.eventId&&s.title===e.title&&s.startAt===e.startAt&&s.endAt===e.endAt&&s.status===e.status))) return error("No se pudo verificar la importación.",503);
      return Response.json({imported:true,count:parsed.length});
    }    if (action === "createPatient") {
      const name = string(input.name, 180), birthDateInput = typeof input.birthDate === "string" ? input.birthDate.trim() : "", birthDate = string(birthDateInput, 10), rutRaw = string(input.rut, 20), phone = string(input.phone, 24), email = string(input.email, 254);
      if (!validPhone(phone) || !validEmail(email)) return error("Revisa el teléfono y el correo electrónico.");
      if (!hasFourNameParts(name)) return error(fullNameRequiredMessage());
      if (birthDateInput.length > 10 || !birthDate || !validDate(birthDate) || birthDate > dateInChile() || Number(birthDate.slice(0, 4)) < Number(dateInChile().slice(0, 4)) - 125 || (rutRaw && !validRut(rutRaw))) return error("Revisa el nombre, fecha de nacimiento y RUT. La fecha de nacimiento es obligatoria.");
      const rut = rutRaw ? cleanRut(rutRaw) : null;
      if (rut && (await db.select({ id: patients.id }).from(patients).where(and(eq(patients.ownerId, ownerId), eq(patients.rut, rut)))).length) return error("Ya existe un paciente con ese RUT.", 409);
      const t = now();
      const [p] = await db.insert(patients).values({ ownerId, name, birthDate, rut, phone, email, reason: string(input.reason, 240) || "Evaluación", status: "Evaluación", allergies: "Sin registrar", history: "Sin registrar", createdAt: t, updatedAt: t }).returning();
      return Response.json({ patient: { ...p, rut: rutRaw || "" } }, { status: 201 });
    }
    if (action === "previewDriveRecords" || action === "importDriveRecords") {
      try {
        const outcome = await runDriveRecordImport(ownerId, input.records, action === "importDriveRecords");
        if (action === "previewDriveRecords") return Response.json(outcome);
        if (!outcome.imported) return error(outcome.message || "No se pudo confirmar la importación.", 409);
        return Response.json({ result: outcome.result });
      } catch (e) {
        if (e instanceof ClinicalImportError) return error(e.message, e.status);
        throw e;
      }
    }
    if (!Number.isSafeInteger(patientId) || patientId <= 0) return error("Selecciona un paciente válido.");
    const [patient] = await db.select({ id: patients.id, name: patients.name }).from(patients).where(and(eq(patients.id, patientId), eq(patients.ownerId, ownerId)));
    if (!patient) return error("Paciente no encontrado.", 404);
    if (action === "updatePatient") {
      const nameInput = typeof input.name === "string" ? input.name.trim() : patient.name;
      const normalizedName = normalizePatientName(nameInput), storedNormalizedName = normalizePatientName(patient.name);
      const nameParts = normalizedName.split(/\s+/).filter(Boolean);
      if (nameInput.length > 180 || !normalizedName || (normalizedName !== storedNormalizedName && nameParts.length < 2)) return error("Para cambiar el nombre de una ficha existente, ingresa al menos un nombre y un apellido.");
      if (normalizedName !== storedNormalizedName) {
        const otherPatients = await db.select({ id: patients.id, name: patients.name }).from(patients).where(eq(patients.ownerId, ownerId));
        if (otherPatients.some(other => other.id !== patientId && normalizePatientName(other.name) === normalizedName)) return error("Ya hay otra ficha con ese nombre. Verifica la identidad antes de actualizar.", 409);
      }
      const phone = string(input.phone, 24), email = string(input.email, 254);
      if (!validPhone(phone) || !validEmail(email)) return error("Revisa el teléfono y el correo electrónico.");
      const hasRut = Object.prototype.hasOwnProperty.call(input, "rut");
      const rutRaw = hasRut ? string(input.rut, 20).trim() : "";
      if (hasRut && rutRaw && !validRut(rutRaw)) return error("Revisa el RUN / RUT y su dígito verificador.");
      const rut = rutRaw ? cleanRut(rutRaw) : null;
      if (rut) {
        const [duplicate] = await db.select({ id: patients.id }).from(patients).where(and(eq(patients.ownerId, ownerId), eq(patients.rut, rut), ne(patients.id, patientId))).limit(1);
        if (duplicate) return error("Ya existe otro paciente con ese RUN / RUT.", 409);
      }
      const allergies = string(input.allergies, 2000) || "Sin registrar";
      const history = string(input.history, 10000) || "Sin registrar";
      const changes = { name: nameInput, phone, email, allergies, history, updatedAt: now(), ...(hasRut ? { rut } : {}) };
      const [updated] = await db.update(patients).set(changes).where(and(eq(patients.id, patientId), eq(patients.ownerId, ownerId))).returning();
      return Response.json({ patient: { ...updated, rut: updated.rut || "" } });
    }
    if (action === "addNote") {
      const title = string(input.title, 180) || "Evolución clínica", body = string(input.body, 30000);
      if (!body) return error("Escribe o dicta el registro clínico.");
      const t = now(), clinicalDate = dateInChile();
      const requestId = string(input.requestId, 80) || null;
      if (requestId) {
        const [existing] = await db.select().from(evolutions).where(and(eq(evolutions.ownerId, ownerId), eq(evolutions.requestId, requestId)));
        if (existing && existing.patientId !== patientId) return error("Esta solicitud pertenece a otra ficha.", 409);
        if (existing) return Response.json({ note: { id: existing.id, patientId: existing.patientId, date: displayDate(existing.clinicalDate), clinicalDate: existing.clinicalDate, recordedAt: existing.recordedAt, title: existing.title, body: existing.body, backupStatus: existing.backupStatus } });
      }
      const [n] = await db.insert(evolutions).values({ ownerId, patientId, clinicalDate, recordedAt: t, title, body, requestId, backupStatus: "not_configured" }).returning();
      let chart;
      try { chart = await syncInstalledImplants(ownerId, patientId, body, t); }
      catch { chart = { updatedTeeth: [], odontogram: null, warning: "Evolución guardada; revisa el odontograma, cuya actualización no pudo verificarse." }; }
      return Response.json({ note: { id: n.id, patientId, date: displayDate(clinicalDate), clinicalDate, recordedAt: t, title, body, backupStatus: n.backupStatus }, chart }, { status: 201 });
    }
    if (action === "syncEvolutionOdontogram") {
      const evolutionId = Number(input.evolutionId);
      if (!Number.isSafeInteger(evolutionId) || evolutionId <= 0) return error("Evolución inválida.");
      const [note] = await db.select().from(evolutions).where(and(eq(evolutions.id, evolutionId), eq(evolutions.patientId, patientId), eq(evolutions.ownerId, ownerId))).limit(1);
      if (!note) return error("Evolución no encontrada en esta ficha.", 404);
      const chart = await syncInstalledImplants(ownerId, patientId, note.body, note.recordedAt);
      return Response.json({ chart });
    }
    if (action === "addBudget") {
      const title = string(input.title, 180), label = string(input.label, 180), amount = Number(input.amount);
      if (!title || !label || !Number.isSafeInteger(amount) || amount < 1 || amount > 1000000000) return error("Revisa el plan, la prestación y su valor.");
      const t = now(), items = [{ label, amount }];
      const [b] = await db.insert(budgets).values({ ownerId, patientId, title, items: JSON.stringify(items), status: "Borrador", createdAt: t }).returning();
      return Response.json({ budget: { id: b.id, patientId, title, items, status: b.status, date: displayDate(t.slice(0, 10)) } }, { status: 201 });
    }
    if (action === "updateBudget") {
      const budgetId = Number(input.budgetId), title = string(input.title, 180), label = string(input.label, 180), amount = Number(input.amount);
      if (!Number.isSafeInteger(budgetId) || budgetId < 1 || !title || !label || !Number.isSafeInteger(amount) || amount < 1 || amount > 1000000000) return error("Revisa el plan, la prestación y su valor.");
      const [existing] = await db.select().from(budgets).where(and(eq(budgets.id, budgetId), eq(budgets.patientId, patientId), eq(budgets.ownerId, ownerId)));
      if (!existing) return error("Presupuesto no encontrado.", 404);
      const items = [{ label, amount }];
      const [b] = await db.update(budgets).set({ title, items: JSON.stringify(items) }).where(and(eq(budgets.id, budgetId), eq(budgets.patientId, patientId), eq(budgets.ownerId, ownerId))).returning();
      return Response.json({ budget: { id: b.id, patientId, title, items, status: b.status, date: displayDate(b.createdAt.slice(0, 10)) } });
    }
    if (action === "addAppointment") {
      const day = string(input.day, 10), time = string(input.time, 5), reason = string(input.reason, 500);
      if (!validDate(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !reason) return error("Revisa fecha, hora y motivo.");
      const [a] = await db.insert(appointments).values({ ownerId, patientId, day, time, reason, createdAt: now() }).returning();
      return Response.json({ appointment: { id: a.id, patientId, day: day.split("-").reverse().join("-"), time, reason } }, { status: 201 });
    }
    if (action === "updateAppointmentReason") {
      const appointmentId = Number(input.appointmentId), reason = string(input.reason, 500);
      if (!Number.isSafeInteger(appointmentId) || appointmentId < 1 || !reason) return error("Revisa la cita y el motivo.");
      const [a] = await db.update(appointments).set({ reason }).where(and(eq(appointments.id, appointmentId), eq(appointments.patientId, patientId), eq(appointments.ownerId, ownerId))).returning();
      if (!a) return error("Cita no encontrada en esta ficha.", 404);
      return Response.json({ appointment: { id: a.id, patientId, day: a.day.split("-").reverse().join("-"), time: a.time, reason: a.reason } });
    }
    if (action === "savePerio") {
      if (!validPerioTeeth(input.teeth) || JSON.stringify(input.teeth).length > 150000) return error("Examen periodontal inválido.");
      const validEpbCodes = new Set(["0","1","2","3","4","*"]), validSextants = new Set(["1","2","3","4","5","6"]);
      if (input.epb !== undefined && (!input.epb || typeof input.epb !== "object" || Array.isArray(input.epb) || Object.entries(input.epb).some(([key,value])=>!validSextants.has(key)||!validEpbCodes.has(String(value))))) return error("Códigos EPB inválidos.");
      if (input.classification !== undefined) {
        if (!input.classification || typeof input.classification !== "object" || Array.isArray(input.classification)) return error("Clasificación periodontal inválida.");
        const c=input.classification as Record<string,unknown>;
        if (c.system!=="AAP-EFP 2017" || (c.stage!==undefined&&!['I','II','III','IV'].includes(String(c.stage))) || (c.grade!==undefined&&!['A','B','C'].includes(String(c.grade))) || (c.extent!==undefined&&!['localized','generalized','molar-incisor'].includes(String(c.extent)))) return error("Clasificación periodontal inválida.");
      }
      const savedData={teeth:input.teeth,epb:input.epb,classification:input.classification};
      const [e] = await db.insert(periodontalExams).values({ ownerId, patientId, recordedAt: now(), teeth: JSON.stringify(savedData) }).returning();
      return Response.json({ exam: { id: e.id, recordedAt: e.recordedAt, ...savedData } }, { status: 201 });
    }
    if (action === "setToothStatus") {
      const tooth = Number(input.tooth), status = string(input.status, 48);
      if (!Number.isSafeInteger(tooth) || !allowedTeeth.has(tooth) || !["Sin hallazgos", "Implante", "Corona", "Ausente", "Indicación de exodoncia", "Resto radicular con endodoncia"].includes(status)) return error("Estado dental inválido.");
      const [old] = await db.select().from(toothStatuses).where(and(eq(toothStatuses.ownerId, ownerId), eq(toothStatuses.patientId, patientId)));
      const data = normalizeOdontogram(old ? JSON.parse(old.data) : {});
      if (status === "Sin hallazgos") delete data.teeth[tooth];
      else data.teeth[tooth] = status;
      if (status === "Corona" && data.crowns?.[tooth]) data.crowns[tooth] = { ...data.crowns[tooth], foundation: "tooth" };
      else if (!(status === "Implante" && data.crowns?.[tooth]?.foundation === "implant")) delete data.crowns?.[tooth];
      await db.insert(toothStatuses).values({ ownerId, patientId, data: JSON.stringify(data), updatedAt: now() }).onConflictDoUpdate({ target: toothStatuses.patientId, set: { data: JSON.stringify(data), updatedAt: now() } });
      return Response.json({ odontogram: data });
    }
    if (action === "setCrownDetails") {
      const tooth = Number(input.tooth), material = string(input.material, 60), shade = string(input.shade, 10);
      const requested = input.foundation === "implant" || input.foundation === "tooth" ? input.foundation : null;
      if (!Number.isSafeInteger(tooth) || !allowedTeeth.has(tooth) || (material && !["Zirconio","Disilicato","Metal cerámica","Resina","Otro"].includes(material)) || (shade && !/^[A-D][1-4](?:\.5)?$/i.test(shade))) return error("Revisa la pieza y el material de la corona.");
      const [old] = await db.select().from(toothStatuses).where(and(eq(toothStatuses.ownerId, ownerId), eq(toothStatuses.patientId, patientId))).limit(1);
      const data = normalizeOdontogram(old ? JSON.parse(old.data) : {});
      const foundation = requested ?? (data.teeth[tooth] === "Implante" ? "implant" : "tooth");
      if (foundation === "implant" && data.teeth[tooth] !== "Implante") return error("Primero registra el implante en la pieza indicada.");
      if (foundation === "tooth" && data.teeth[tooth] !== "Corona") return error("Primero registra una corona en la pieza indicada.");
      if (!material && foundation !== "implant") return error("Revisa la pieza y el material de la corona.");
      data.crowns![tooth] = { material: material || data.crowns?.[tooth]?.material || "", shade: shade || null, source: "manual", foundation };
      const updatedAt = now();
      await db.insert(toothStatuses).values({ ownerId, patientId, data: JSON.stringify(data), updatedAt }).onConflictDoUpdate({ target: toothStatuses.patientId, set: { data: JSON.stringify(data), updatedAt } });
      const [verified] = await db.select({ data: toothStatuses.data }).from(toothStatuses).where(and(eq(toothStatuses.ownerId, ownerId), eq(toothStatuses.patientId, patientId))).limit(1);
      const confirmed = verified ? normalizeOdontogram(JSON.parse(verified.data)).crowns?.[tooth] : null;
      if (!confirmed || confirmed.foundation !== foundation || (material && confirmed.material !== material) || (shade && (confirmed.shade || "") !== shade)) return error("No se pudo verificar el material de la corona.", 503);
      return Response.json({ odontogram: data });
    }
    if (action === "setToothMissingReason") {
      const tooth = Number(input.tooth), reason = string(input.reason, 16);
      if (!Number.isSafeInteger(tooth) || !allowedTeeth.has(tooth) || !["caries","other","unknown"].includes(reason)) return error("Causa de pérdida inválida.");
      const [old] = await db.select().from(toothStatuses).where(and(eq(toothStatuses.ownerId, ownerId), eq(toothStatuses.patientId, patientId)));
      const data = normalizeOdontogram(old ? JSON.parse(old.data) : {});
      if (!data.teeth[tooth] || !["Ausente","Indicación de exodoncia"].includes(data.teeth[tooth])) return error("Primero registra la pieza como ausente o indicada para exodoncia.");
      data.missingReason[tooth] = reason as "caries"|"other"|"unknown";
      await db.insert(toothStatuses).values({ ownerId, patientId, data: JSON.stringify(data), updatedAt: now() }).onConflictDoUpdate({ target: toothStatuses.patientId, set: { data: JSON.stringify(data), updatedAt: now() } });
      return Response.json({ odontogram: data });
    }
    if (action === "setToothSurface") {
      const tooth = Number(input.tooth), surface = string(input.surface, 2), raw = input.finding;
      if (!Number.isSafeInteger(tooth) || !allowedTeeth.has(tooth) || !surfaceKeys.has(surface) || !raw || typeof raw !== "object" || Array.isArray(raw)) return error("Superficie dental inválida.");
      const finding = raw as Record<string,unknown>, condition = string(finding.condition,32);
      if (!["not_examined","sound","caries","restored","sealant","other_restoration"].includes(condition)) return error("Estado de superficie inválido.");
      let normalized:SurfaceFinding;
      if (condition === "caries") {
        const icdas = Number(finding.icdas), activity = string(finding.activity,16);
        if (!Number.isInteger(icdas) || icdas < 1 || icdas > 6 || !["active","inactive","uncertain"].includes(activity)) return error("Completa el código ICDAS y la actividad de la lesión.");
        normalized = { condition:"caries", icdas:icdas as 1|2|3|4|5|6, activity:activity as "active"|"inactive"|"uncertain" };
      } else normalized = { condition:condition as SurfaceFinding["condition"], icdas:null, activity:null };
      const [old] = await db.select().from(toothStatuses).where(and(eq(toothStatuses.ownerId, ownerId), eq(toothStatuses.patientId, patientId)));
      const data = normalizeOdontogram(old ? JSON.parse(old.data) : {});
      if (["Ausente","Implante"].includes(data.teeth[tooth]??"")) return error("No se registran superficies dentarias en dientes ausentes o implantes.");
      data.surfaces[tooth] = { ...(data.surfaces[tooth]??{}), [surface as OdontogramSurface]: normalized };
      await db.insert(toothStatuses).values({ ownerId, patientId, data: JSON.stringify(data), updatedAt: now() }).onConflictDoUpdate({ target: toothStatuses.patientId, set: { data: JSON.stringify(data), updatedAt: now() } });
      return Response.json({ odontogram: data });
    }
    return error("Acción no reconocida.");
  } catch {
    return error("No se pudo guardar. Comprueba la conexión y vuelve a intentarlo.", 503);
  }
}
