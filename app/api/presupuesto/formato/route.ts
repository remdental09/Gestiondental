import { getChatGPTUser, personalIdOf } from "@/app/chatgpt-auth";
import { loadBudgetFormat, saveBudgetFormat } from "@/app/budget-format-db";
import { loadProfile } from "@/app/clinician-profile-db";
import { loadClinic } from "@/app/clinic-profile-db";
import { loadDocumentMark, loadStampMark } from "@/app/document-mark-db";
import { checkBudgetFormat } from "@/lib/budget-format";
import { buildBudgetPdf } from "@/lib/budget-pdf";
import { displayName } from "@/lib/clinician-profile";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const fail = (error: string, status = 400) => Response.json({ error }, { status, headers });

/** GET: formato del PDF del profesional que entra (su id personal: en una clínica, cada colega tiene el suyo). */
export async function GET() {
  const user = await getChatGPTUser();
  if (!user?.userId) return fail("Inicia sesión.", 401);
  const personalId = personalIdOf(user);
  const [format, clinic, ownClinic] = await Promise.all([
    loadBudgetFormat(personalId), loadClinic(user.userId).catch(() => null),
    personalId === user.userId ? Promise.resolve(null) : loadClinic(personalId).catch(() => null),
  ]);
  // Datos del perfil de la clínica del espacio, para ofrecer «Usar los datos del perfil» en el diseño.
  // Los datos del diseño son de la consulta propia del profesional: se ofrecen los del perfil de SU consulta, no los de la clínica donde es invitado.
  const own = ownClinic ?? clinic;
  const profileClinic = own ? { name: own.clinicName, rut: "", address: own.address, city: own.city, phone: own.phone, email: own.email, web: "" } : null;
  return Response.json({ format, hasLogo: Boolean(clinic?.logo), logoEmbeddable: /^data:image\/(png|jpeg);/.test(clinic?.logo ?? ""), profileClinic }, { headers });
}

/**
 * POST {action:"guardar", format} guarda; POST {action:"vista", format} devuelve un PDF de ejemplo con ese formato
 * (paciente y prestaciones ficticias, sin datos reales) para verlo antes de guardar.
 */
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return fail("Inicia sesión.", 401);
  if (request.headers.get("origin") !== new URL(request.url).origin) return fail("Origen no permitido.", 403);
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return fail("Solicitud no válida."); }
  const checked = checkBudgetFormat(body?.format);
  if (!checked.ok) return fail(checked.error);
  const personalId = personalIdOf(user);
  try {
    if (body.action === "guardar") {
      await saveBudgetFormat(personalId, checked.format);
      return Response.json({ format: checked.format }, { headers });
    }
    if (body.action === "vista") {
      const [profile, clinic, space, documentMark, stampMark] = await Promise.all([
        loadProfile(personalId).catch(() => null), loadClinic(user.userId).catch(() => null),
        personalId === user.userId ? Promise.resolve(null) : loadProfile(user.userId).catch(() => null),
        loadDocumentMark(personalId).catch(() => ""), loadStampMark(personalId).catch(() => ""),
      ]);
      const bytes = await buildBudgetPdf({
        budget: { id: 123, title: "Plan de ejemplo (vista previa)", date: "17 nov 2026", items: [
          { label: "Destartraje y pulido", amount: 45000, phase: "Fase 1 · Higiénica", zone: "perm:boca" },
          { label: "Pulpotomía", amount: 60000, phase: "Fase 1 · Higiénica", zone: "temp:molares", area: "según radiografía" },
          { label: "Implante oseointegrado", amount: 790000, phase: "Fase 2 · Rehabilitación", teeth: [36], discountPercent: 10 },
          { label: "Raspado y alisado radicular", amount: 120000, phase: "Fase 2 · Rehabilitación", zone: "perm:parcial", teeth: [16, 26], area: "sitios con sacos > 4 mm" },
        ] },
        patientName: "Paciente de ejemplo", patientDocument: "11.111.111-1",
        professionalName: profile ? displayName(profile) : "Dr(a). Nombre Apellido", professionalSpecialty: profile?.specialty, professionalDocument: profile?.rut,
        professionalTitles: profile?.extraTitles || undefined,
        clinicName: (personalId === user.userId ? profile?.clinicName : space?.clinicName) || undefined,
        format: checked.format, logo: clinic?.logo || undefined, documentMark: documentMark || undefined, stampMark: stampMark || undefined,
      });
      return new Response(bytes as BodyInit, { headers: { "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="vista-previa-presupuesto.pdf"', "Cache-Control": "no-store" } });
    }
    return fail("Acción no reconocida.");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "No se pudo guardar.", 500);
  }
}
