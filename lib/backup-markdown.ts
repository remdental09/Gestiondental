import { chileDay } from "./chile-day.ts";
import { implantSummary, phaseLabel, type backupImplant } from "./implants.ts";
import { categoryLabel, parseDetails, productFigureLines, type ProductCategory } from "./biomedical-products.ts";

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
  imageMetadata: Array<{ name: string; driveFile?: string; kind?: string | null; note?: string | null; addedAt?: string | null }>;
  implants?: Array<ReturnType<typeof backupImplant>>;
  biomedicalProducts?: Array<{ id: number; category?: string; brand?: string; model?: string; diameter?: string; length?: string; reference?: string; lot?: string; serial?: string; manufactured?: string; expiry?: string;
    manufacturer?: string; registration?: string; gtin?: string; details?: unknown; code?: string; tooth?: string; placedOn?: string; note?: string }>;
  documents?: Array<{ title: string; kind?: string; content: string; status?: string; createdAt?: string; createdByName?: string; signature?: { signerName: string; signerRole: string; signerRelation: string; signedAt: string; method: string; signatureHash: string } }>;
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

  if (record.implants?.length) out.push("## Implantes", "", ...record.implants.map(item => {
    const label = record.biomedicalProducts?.find(product => product.id === item.productId);
    const trace = label ? [label.reference && `ref. ${label.reference}`, label.lot && `lote ${label.lot}`, label.serial && `serie ${label.serial}`].filter(Boolean).join(", ") : "";
    const details = [implantSummary(item), trace && `etiqueta: ${cell(trace)}`, item.placedOn && `instalado ${item.placedOn.split("-").reverse().join("-")}`, item.torque !== null && `torque ${item.torque} Ncm`, item.isq !== null && `ISQ ${item.isq}`,
      item.images.length && `imágenes: ${item.images.map(image => `${image.view} (adjunto ${image.imageId})`).join(", ")}`, item.note.replace(/\n/g, " ")].filter(Boolean);
    return `- **${item.tooth}** · ${phaseLabel(item.phase)}${details.length ? ` · ${details.join(" · ")}` : ""}`;
  }), "");

  if (record.biomedicalProducts?.length) out.push("## Productos biomédicos", "", ...record.biomedicalProducts.map(item => {
    const lines = productFigureLines({ ...item, reference: item.reference ?? "", lot: item.lot ?? "", serial: item.serial ?? "", expiry: item.expiry ?? "", manufacturer: item.manufacturer ?? "", note: item.note ?? "",
      details: "[]", placedOnLabel: item.placedOn ? item.placedOn.split("-").reverse().join("-") : "sin fecha" });
    const rest = [...parseDetails(item.details).map(detail => detail.label ? `${detail.label}: ${detail.value}` : detail.value), item.code ? `Contenido del código: ${item.code}` : ""];
    return `- **${categoryLabel((item.category || "otro") as ProductCategory)}**${item.brand ? ` · ${cell(item.brand)}` : ""}${item.tooth ? ` · pieza ${item.tooth}` : ""} · ${[...lines, ...rest].filter(Boolean).map(cell).join(" · ")}`;
  }), "");

  out.push("## Presupuestos", "");
  if (!record.budgets.length) out.push("Sin presupuestos.", "");
  for (const b of record.budgets) {
    const total = b.items.reduce((sum, item) => sum + (Number(item.amount) || 0) * (1 - (Number(item.discountPercent) || 0) / 100), 0);
    out.push(`### ${b.title}${b.isAlternative ? " (alternativa)" : ""} · ${clean(b.status)} · ${money(total)}`, "", "| Prestación | Fase | Piezas (FDI) | Valor | Realizada |", "|---|---|---|---|---|",
      ...b.items.map(item => `| ${cell(item.label)} | ${cell(item.phase)} | ${item.teeth?.length ? item.teeth.map(fdi).join(", ") : "—"} | ${money(Number(item.amount) || 0)}${item.discountPercent ? ` (−${item.discountPercent}%)` : ""} | ${item.doneOn ? day(item.doneOn) : "pendiente"} |`), "");
  }

  if (record.appointments.length) out.push("## Citas", "", ...record.appointments.map(v => `- ${day(v.day)} ${v.time} · ${v.reason}`), "");
  if (record.documents?.length) {
    out.push("## Documentos clínicos", "", "_Documentos guardados como borradores en la aplicación._", "");
    for (const document of record.documents) {
      let values: Record<string, unknown> = {};
      try { values = JSON.parse(document.content) as Record<string, unknown>; } catch { /* el contenido original queda además en el JSON estructurado */ }
      out.push(`### ${document.title} · ${day(document.createdAt)} · ${clean(document.status)}`, "");
      if (document.createdByName) out.push(`- **Profesional:** ${cell(document.createdByName)}`);
      if (document.signature) out.push(`- **Firma del paciente:** ${cell(document.signature.signerName)}${document.signature.signerRelation ? ` (${cell(document.signature.signerRelation)})` : ""} · ${day(document.signature.signedAt)} · firma electrónica simple, método ${cell(document.signature.method)} · huella ${document.signature.signatureHash.slice(0, 16)}`);
      for (const [key, value] of Object.entries(values)) if (typeof value === "string" && value.trim()) out.push(`- **${cell(key)}:** ${value.trim().replace(/\n/g, "\n  ")}`);
      out.push("");
    }
  }
  if (record.imageMetadata.length) out.push("## Imágenes y documentos", "", "_Cada archivo se respalda en esta misma carpeta de Drive con el nombre indicado._", "",
    ...record.imageMetadata.map(i => `- ${i.driveFile || i.name}${i.kind ? ` (${i.kind})` : ""}${i.addedAt ? ` · ${day(i.addedAt)}` : ""}${i.note ? ` · ${i.note.replace(/\n/g, " ")}` : ""}`), "");
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
