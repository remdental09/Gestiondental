import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { patients } from "@/db/schema";

export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
export const sameOrigin = (request: Request) => request.headers.get("origin") === new URL(request.url).origin;
export const positiveId = (raw: unknown) => { const n = Number(raw); return Number.isSafeInteger(n) && n > 0 ? n : null; };

/** El paciente debe pertenecer al espacio de quien pide; si no, se responde 404 sin revelar nada. */
export async function ownedPatient(ownerId: string, raw: unknown) {
  const patientId = positiveId(raw);
  if (!patientId) return null;
  const [p] = await getDb().select({ id: patients.id }).from(patients).where(and(eq(patients.id, patientId), eq(patients.ownerId, ownerId))).limit(1);
  return p ? patientId : null;
}
export const isIsoDay = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
export const shortText = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");
