import { env } from "cloudflare:workers";
import { desc, eq } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { appointments, budgets, clinicalImages, driveBackups, evolutions, patients, payments, periodontalExams, toothStatuses } from "@/db/schema";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const fail = (message: string, status = 400) => Response.json({ error: message }, { status });

function toBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

export async function GET() {
  const ownerId = (await getChatGPTUser())?.userId;
  if (!ownerId) return fail("Inicia sesión para descargar las fichas.", 401);

  try {
    const db = getDb();
    const [patientRows, allEvolutionRows, budgetRows, appointmentRows, perioRows, toothRows, imageRows, backupRows, paymentRows] = await Promise.all([
      db.select().from(patients).where(eq(patients.ownerId, ownerId)).orderBy(patients.name),
      db.select().from(evolutions).where(eq(evolutions.ownerId, ownerId)).orderBy(desc(evolutions.clinicalDate), desc(evolutions.recordedAt)),
      db.select().from(budgets).where(eq(budgets.ownerId, ownerId)).orderBy(desc(budgets.id)),
      db.select().from(appointments).where(eq(appointments.ownerId, ownerId)).orderBy(appointments.day),
      db.select().from(periodontalExams).where(eq(periodontalExams.ownerId, ownerId)).orderBy(desc(periodontalExams.id)),
      db.select().from(toothStatuses).where(eq(toothStatuses.ownerId, ownerId)),
      db.select().from(clinicalImages).where(eq(clinicalImages.ownerId, ownerId)).orderBy(desc(clinicalImages.id)),
      db.select().from(driveBackups).where(eq(driveBackups.ownerId, ownerId)),
      db.select().from(payments).where(eq(payments.ownerId, ownerId)).orderBy(desc(payments.paidOn)),
    ]);

    // Las evoluciones anuladas no salen en la descarga; se conservan en la base y en el respaldo de Drive (marcadas).
    const evolutionRows = allEvolutionRows.filter((row) => row.status !== "anulada");
    const annulledEvolutionsOmitted = allEvolutionRows.length - evolutionRows.length;

    const images = await Promise.all(imageRows.map(async (image) => {
      const object = env.BUCKET ? await env.BUCKET.get(image.objectKey) : null;
      const bytes = object ? new Uint8Array(await object.arrayBuffer()) : null;
      return {
        ...image,
        contentBase64: bytes ? toBase64(bytes) : null,
        contentAvailable: Boolean(bytes),
      };
    }));

    const payload = {
      format: "gestion-dental-clinical-export",
      version: 1,
      exportedAt: new Date().toISOString(),
      tables: {
        patients: patientRows,
        evolutions: evolutionRows,
        budgets: budgetRows,
        appointments: appointmentRows,
        payments: paymentRows,
        periodontalExams: perioRows,
        toothStatuses: toothRows,
        clinicalImages: images,
        driveBackups: backupRows,
      },
      counts: {
        patients: patientRows.length,
        evolutions: evolutionRows.length,
        annulledEvolutionsOmitted,
        budgets: budgetRows.length,
        appointments: appointmentRows.length,
        payments: paymentRows.length,
        periodontalExams: perioRows.length,
        toothStatuses: toothRows.length,
        clinicalImages: images.length,
        unavailableImageFiles: images.filter((image) => !image.contentAvailable).length,
        driveBackups: backupRows.length,
      },
    };

    const filename = `gestion-dental-pacientes-${new Date().toISOString().slice(0, 10)}.json`;
    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return fail("No se pudo generar la descarga de las fichas. Intenta de nuevo.", 503);
  }
}
