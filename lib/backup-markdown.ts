import { chileDay } from "./chile-day.ts";

/**
 * Ficha clínica en Markdown: legible por cualquier persona y cualquier programa, sin depender de la app.
 * Se arma con los mismos datos del respaldo (no agrega ni deduce nada).
 */

type Item = { label?: string; amount?: number; phase?: string; teeth?: number[]; discountPercent?: number; code?: string; doneOn?: string };
export type MarkdownRecord = {
  patient: { id: number; name: string; birthDate?: string | null; rut?: string | null; phone?: string | null; email?: string | null; reason?: string | null; status?: string | null; allergies?: string | null; history?: string | null; createdAt?: string | null };
  address?: { street: string; commune: string; country: string } | null;
  anamnesis?: Record<string, unknown> | null;
  evolutions: Array<{ id: number; clinicalDate?: string | null; recordedAt?: string | null; title: string; body: string; status?: string; annulledAt?: string | null; annulledBy?: string | null; annulReason?: string | null }>;
  budgets: Array<{ id: number; title: string; items: Item[]; status?: string | null; createdAt?: string | null; isAlternative?: boolean }>;
  appointments: Array<{ day: string; time: string; reason: string }>;
  periodontalExams: Array<{ recordedAt: string; data: unknown }>;
  odontogram: { teeth?: Record<string, string>; surfaces?: Record<string, Record<string, { condition?: string; depth?: string | null; restorationMaterial?: string | null } | null>>; crowns?: Record<string, { material?: string; foundation?: string } | null>; missingReason?: Record<string, string> } | null;
  imageMetadata: Array<{ name: string; kind?: string | null; note?: string | null; addedAt?: string | null }>;
};

const fdi = (tooth: string | number) => { const n = Number(tooth); return `${Math.floor(n / 10)}.${n % 10}`; };
const clean = (value: unknown) => (value == null || value === "" ? "Sin registrar" : String(value));
const day = (iso?: string | null) => (iso ? chileDay(iso).split("-").reverse().join("-") : "sin fecha");
const money = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
/** Evita que un texto clínico rompa la estructura (encabezados o tablas). */
const cell = (value: unknown) => clean(value).replace(/\|/g, "/").replace(/\s*\n\s*/g, " ");

const CONDITION: Record<string, string> = { caries: "caries", restored: "obturación", sealant: "sellante", other_restoration: "otra restauración", sound: "sana", not_examined: "sin examinar" };
const ANAMNESIS_LABELS: Record<string, string> = {
  allergies: "Alergias", medications: "Medicamentos", anticoagulants: "Anticoagulantes", conditions: "Enfermedades", otherConditions: "Otras enfermedades",
  surgeries: "Cirugías", hospitalizations: "Hospitalizaciones", anesthesiaReactions: "Reacciones a anestesia", pregnancy: "Embarazo / lactancia",
  smoking: "Tabaco", alcohol: "Alcohol", bruxism: "Bruxismo", gumBleeding: "Sangrado de encías", lastDentalVisit: "Última visita dental",
  dentalHistory: "Antecedentes odontológicos", observations: "Observaciones",
};

/** `generatedAt` vacío deja el texto estable (el respaldo compara huellas para saber si la ficha cambió). */
export function fichaMarkdown(record: MarkdownRecord, generatedAt = ""): string {
  const p = record.patient;
  const out: string[] = [];
  out.push(`# Ficha clínica · ${p.name}`, "", `_Respaldo de Gestión Dental · ficha ${p.id}${generatedAt ? ` · generado ${day(generatedAt)}` : ""}_`, "");

  out.push("## Datos del paciente", "",
    `- **RUT:** ${clean(p.rut)}`, `- **Fecha de nacimiento:** ${clean(p.birthDate)}`, `- **Teléfono:** ${clean(p.phone)}`, `- **Correo:** ${clean(p.email)}`,
    `- **Dirección:** ${record.address && (record.address.street || record.address.commune) ? [record.address.street, record.address.commune, record.address.country].filter(Boolean).join(", ") : "Sin registrar"}`,
    `- **Motivo de consulta:** ${clean(p.reason)}`, `- **Estado:** ${clean(p.status)}`, `- **Alergias (ficha):** ${clean(p.allergies)}`, `- **Antecedentes (ficha):** ${clean(p.history)}`, "");

  const a = record.anamnesis;
  if (a) {
    const rows = Object.entries(ANAMNESIS_LABELS).map(([key, label]) => {
      const value = a[key];
      const text = Array.isArray(value) ? value.join(", ") : value === "si" ? "Sí" : value === "no" ? "No" : value;
      return text ? `- **${label}:** ${String(text).replace(/\n/g, " ")}` : "";
    }).filter(Boolean);
    out.push("## Anamnesis", "", ...(rows.length ? rows : ["Sin datos registrados."]), "");
  }

  out.push("## Evoluciones", "");
  if (!record.evolutions.length) out.push("Sin evoluciones registradas.", "");
  const ordered = [...record.evolutions].sort((x, y) => String(y.clinicalDate ?? y.recordedAt ?? "").localeCompare(String(x.clinicalDate ?? x.recordedAt ?? "")));
  for (const e of ordered) {
    out.push(`### ${day(e.clinicalDate ?? e.recordedAt)} · ${e.title}`, "");
    if (e.status === "anulada") out.push(`> **Anulada** el ${day(e.annulledAt)}${e.annulledBy ? ` por ${e.annulledBy}` : ""}. Motivo: ${clean(e.annulReason)}`, "");
    out.push(e.body.trim() || "(sin texto)", "");
  }

  const o = record.odontogram;
  out.push("## Odontograma (estado actual)", "");
  const teeth = new Set<string>([...Object.keys(o?.teeth ?? {}), ...Object.keys(o?.surfaces ?? {}), ...Object.keys(o?.crowns ?? {})]);
  const lines = [...teeth].sort((x, y) => Number(x) - Number(y)).map(tooth => {
    const parts: string[] = [];
    const status = o?.teeth?.[tooth];
    if (status && status !== "Sin hallazgos") parts.push(status);
    const crown = o?.crowns?.[tooth];
    if (crown) parts.push(`corona${crown.material ? " de " + crown.material : ""} ${crown.foundation === "implant" ? "sobre implante" : "sobre diente natural"}`);
    const faces = Object.entries(o?.surfaces?.[tooth] ?? {}).filter(([, f]) => f && f.condition && f.condition !== "not_examined" && f.condition !== "sound")
      .map(([face, f]) => `${CONDITION[f!.condition!] ?? f!.condition} ${face}${f!.depth ? ` (${f!.depth.replace(/_/g, " ")})` : ""}${f!.restorationMaterial ? ` (${f!.restorationMaterial})` : ""}`);
    if (faces.length) parts.push(faces.join(", "));
    const reason = o?.missingReason?.[tooth];
    if (reason) parts.push(`causa: ${reason === "caries" ? "caries" : reason === "other" ? "otra causa" : "sin registrar"}`);
    return parts.length ? `| ${fdi(tooth)} | ${cell(parts.join(" · "))} |` : "";
  }).filter(Boolean);
  out.push(...(lines.length ? ["| Pieza (FDI) | Registro |", "|---|---|", ...lines] : ["Sin hallazgos registrados."]), "");

  if (record.periodontalExams.length) {
    out.push("## Periodontograma", "", ...record.periodontalExams.map(exam => `- Examen del ${day(exam.recordedAt)} (detalle completo en los datos estructurados).`), "");
  }

  out.push("## Presupuestos", "");
  if (!record.budgets.length) out.push("Sin presupuestos.", "");
  for (const b of record.budgets) {
    const total = b.items.reduce((sum, item) => sum + (Number(item.amount) || 0) * (1 - (Number(item.discountPercent) || 0) / 100), 0);
    out.push(`### ${b.title}${b.isAlternative ? " (alternativa)" : ""} · ${clean(b.status)} · ${money(total)}`, "", "| Prestación | Fase | Piezas (FDI) | Valor | Realizada |", "|---|---|---|---|---|",
      ...b.items.map(item => `| ${cell(item.label)} | ${cell(item.phase)} | ${item.teeth?.length ? item.teeth.map(fdi).join(", ") : "—"} | ${money(Number(item.amount) || 0)}${item.discountPercent ? ` (−${item.discountPercent}%)` : ""} | ${item.doneOn ? day(item.doneOn) : "pendiente"} |`), "");
  }

  if (record.appointments.length) out.push("## Citas", "", ...record.appointments.map(v => `- ${day(v.day)} ${v.time} · ${v.reason}`), "");
  if (record.imageMetadata.length) out.push("## Imágenes y documentos", "", "_Los archivos quedan guardados en la aplicación; aquí solo su lista._", "",
    ...record.imageMetadata.map(i => `- ${i.name}${i.kind ? ` (${i.kind})` : ""}${i.addedAt ? ` · ${day(i.addedAt)}` : ""}${i.note ? ` · ${i.note.replace(/\n/g, " ")}` : ""}`), "");
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
