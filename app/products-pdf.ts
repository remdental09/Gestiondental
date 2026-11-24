import { env } from "cloudflare:workers";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { biomedicalProducts, clinicalImages, patients } from "@/db/schema";
import { loadApprovedRegistrations } from "@/app/prestador-db";
import { loadProfile } from "@/app/clinician-profile-db";
import { loadClinic } from "@/app/clinic-profile-db";
import { loadDocumentMark, loadStampLayout, loadStampMark } from "@/app/document-mark-db";
import { buildDocumentPdf } from "@/lib/document-pdf";
import { ageFromBirthDate } from "@/lib/clinical-documents";
import { displayName } from "@/lib/clinician-profile";
import { formatChileanRut, isValidChileanRut } from "@/lib/patient-document";
import { registrationLine } from "@/lib/prestador-certificate";
import { categoryLabel, productFigureLines, productFigureTitle } from "@/lib/biomedical-products";
import { thumbKey } from "@/lib/image-keys";

const toBase64 = (bytes: Uint8Array) => { let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(bin); };
const dateLong = (iso: string) => { const d = new Date(iso.length === 10 ? `${iso}T12:00:00-03:00` : iso); return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat("es-CL", { dateStyle: "long", timeZone: "America/Santiago" }).format(d); };
const MAX_MAIN_BYTES = 1_200_000;

/** Foto para el PDF: el original si es JPG/PNG y no es muy pesado (para que se lean lotes y series); si no, la miniatura. */
async function photoDataUrl(objectKey: string, contentType: string, size: number): Promise<string | undefined> {
  if (!env.BUCKET) return undefined;
  const useMain = (contentType === "image/jpeg" || contentType === "image/png") && size <= MAX_MAIN_BYTES;
  const main = useMain ? await env.BUCKET.get(objectKey) : null;
  const object = main ?? await env.BUCKET.get(thumbKey(objectKey));
  if (!object) return undefined;
  const type = main ? contentType : "image/jpeg";
  return `data:${type};base64,${toBase64(new Uint8Array(await object.arrayBuffer()))}`;
}

/** «Registro de trazabilidad»: los productos del paciente (o los elegidos) con la foto de cada etiqueta, firmados por el profesional que lo imprime. */
export async function renderProductsPdf(ownerId: string, professionalId: string, fallbackName: string, patientId: number, ids: number[]) {
  const db = getDb();
  const [patient] = await db.select().from(patients).where(and(eq(patients.id, patientId), eq(patients.ownerId, ownerId))).limit(1);
  if (!patient) return null;
  const where = [eq(biomedicalProducts.ownerId, ownerId), eq(biomedicalProducts.patientId, patientId)];
  if (ids.length) where.push(inArray(biomedicalProducts.id, ids));
  const products = await db.select().from(biomedicalProducts).where(and(...where)).orderBy(asc(biomedicalProducts.placedOn), asc(biomedicalProducts.id));
  if (!products.length) return { empty: true as const };
  const imageIds = products.map(product => product.imageId).filter((id): id is number => id !== null);
  const images = imageIds.length ? await db.select().from(clinicalImages).where(and(eq(clinicalImages.ownerId, ownerId), inArray(clinicalImages.id, imageIds))) : [];
  const [regs, profile, clinic, mark, stamp, stampLayout] = await Promise.all([
    loadApprovedRegistrations([professionalId]).catch(() => new Map()), loadProfile(professionalId).catch(() => null), loadClinic(ownerId).catch(() => null),
    loadDocumentMark(professionalId).catch(() => ""), loadStampMark(professionalId).catch(() => ""), loadStampLayout(professionalId).catch(() => null),
  ]);
  const reg = regs.get(professionalId) ?? null;
  const doctorName = reg?.fullName ? `${profile?.title ? profile.title + " " : ""}${reg.fullName}`.trim() : (profile ? displayName(profile) : fallbackName) || "Profesional";
  const doctorLines = reg ? [reg.run ? `RUT ${formatChileanRut(reg.run)}` : "", `${reg.profession} (${registrationLine(reg)})`, reg.specialties.join(" · ")].filter(Boolean) : [];
  const age = patient.birthDate ? ageFromBirthDate(patient.birthDate) : null;
  const figures = await Promise.all(products.map(async (product, index) => {
    const image = images.find(item => item.id === product.imageId);
    return {
      title: productFigureTitle(index + 1, product, categoryLabel(product.category)),
      lines: productFigureLines({ ...product, placedOnLabel: dateLong(product.placedOn) }),
      image: image ? await photoDataUrl(image.objectKey, image.contentType, image.size).catch(() => undefined) : undefined,
    };
  }));
  const bytes = await buildDocumentPdf({
    title: "Registro de trazabilidad de productos biomédicos", clinicName: clinic?.clinicName || profile?.clinicName || "Consulta odontológica",
    clinicLines: [[clinic?.address, clinic?.city].filter(Boolean).join(", "), [clinic?.phone, clinic?.email].filter(Boolean).join(" · ")].filter(Boolean), logo: clinic?.logo || undefined,
    doctorName, doctorLines, habilitacion: reg?.qrUrl ? { url: reg.qrUrl, regSis: reg.regSis, code: reg.validationCode || undefined } : undefined,
    patientLines: [`Paciente: ${patient.name}`, `Nro. de documento: ${patient.rut ? (isValidChileanRut(patient.rut) ? formatChileanRut(patient.rut) : patient.rut) : "Sin registrar"}`, `Edad: ${age === null ? "Sin registrar" : `${age} años`}`],
    issuedDate: dateLong(new Date().toISOString()), sections: [], figures,
    note: "Registro de los productos biomédicos utilizados en la atención, con la fotografía de su etiqueta. Los datos de lote, serie y vencimiento fueron revisados por el profesional tratante.",
    doctorMark: mark || undefined, doctorStamp: stamp || undefined, stampLayout,
  });
  return { empty: false as const, bytes, fileName: `trazabilidad-productos-${String(patientId).padStart(5, "0")}.pdf` };
}
