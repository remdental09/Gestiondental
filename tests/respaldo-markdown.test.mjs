import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fichaMarkdown } from "../lib/backup-markdown.ts";

const record = {
  patient: { id: 7, name: "Paciente Ficticia Prueba", birthDate: "1980-05-05", rut: "", phone: "+56 9 1234 5678", email: "", reason: "Control", status: "Evaluación", allergies: "", history: "" },
  address: { street: "Calle Falsa 123", commune: "Ñuñoa", country: "Chile" },
  anamnesis: { allergies: "Penicilina", conditions: ["diabetes"], anticoagulants: "si", medications: "" },
  evolutions: [
    { id: 1, clinicalDate: "2026-11-03", title: "Evaluación", body: "Control | pieza 4.5" },
    { id: 2, clinicalDate: "2026-11-09", title: "Endodoncia · FDI 4.5", body: "Pulpectomía pieza 4.5.", status: "anulada", annulledAt: "2026-11-10T01:00:00Z", annulledBy: "Dr. X", annulReason: "error de pieza" },
  ],
  budgets: [{ id: 1, title: "Plan 1", status: "pendiente", items: [{ label: "Corona | zirconio", amount: 400000, phase: "Fase 1", teeth: [45], discountPercent: 10 }] }],
  appointments: [],
  periodontalExams: [{ recordedAt: "2026-11-07T18:00:00Z", data: {} }],
  odontogram: { teeth: { 45: "Corona", 36: "Implante" }, surfaces: { 16: { O: { condition: "caries", depth: "dentina_profunda" } } }, crowns: { 45: { material: "Zirconio", foundation: "tooth" } }, missingReason: {} },
  imageMetadata: [{ name: "rx.jpg", kind: "radiografía" }],
};

test("la ficha en Markdown es legible y completa", () => {
  const md = fichaMarkdown(record);
  for (const piece of ["# Ficha clínica · Paciente Ficticia Prueba", "**Dirección:** Calle Falsa 123, Ñuñoa, Chile", "**Alergias:** Penicilina", "**Anticoagulantes:** Sí",
    "### 09-11-2026 · Endodoncia · FDI 4.5", "> **Anulada** el 09-11-2026 por Dr. X. Motivo: error de pieza", "| 4.5 | Corona · corona de Zirconio sobre diente natural |",
    "| 1.6 | caries O (dentina profunda) |", "| Corona / zirconio | Fase 1 | 4.5 | $400.000 (−10%) | pendiente |", "- rx.jpg (radiografía)"]) assert.ok(md.includes(piece), piece);
  assert.ok(md.indexOf("09-11-2026") < md.indexOf("03-11-2026"), "evoluciones de la más reciente a la más antigua");
  assert.equal(fichaMarkdown(record), fichaMarkdown(record), "estable: sin fecha de generación la huella no cambia");
});

test("el respaldo en Drive lleva Markdown + JSON y además un archivo .md; la descarga ofrece Markdown", () => {
  const backup = readFileSync(new URL("../app/drive-backup.ts", import.meta.url), "utf8");
  const drive = readFileSync(new URL("../app/drive-oauth.ts", import.meta.url), "utf8");
  const exp = readFileSync(new URL("../app/api/clinical/export/route.ts", import.meta.url), "utf8");
  assert.match(backup, /markdown \+ "\\n---\\n\\n## Datos estructurados \(JSON, para restaurar\)/);
  assert.equal(drive.split("await writeMarkdownFile(").length - 1, 2, "cuenta principal y copias adicionales");
  assert.match(exp, /searchParams\.get\("format"\) === "md"/);
});
