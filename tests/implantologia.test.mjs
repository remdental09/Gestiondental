import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { backupImplant, cleanImplantFields, cleanImplantImage, imageKindForView, implantSuggestions, implantSummary, implantTooth, parseImplantImages } from "../lib/implants.ts";
import { fichaMarkdown } from "../lib/backup-markdown.ts";
import { apiDenied, tabAllowed } from "../lib/role-policy.ts";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const today = "2026-11-24";
const fields = input => cleanImplantFields(input, today);

test("implantes: solo piezas permanentes FDI con punto", () => {
  assert.equal(implantTooth("36"), "3.6");
  assert.equal(implantTooth("1.1"), "1.1");
  assert.equal(implantTooth("75"), "");
  assert.equal(implantTooth("99"), "");
});

test("implantes: basta la pieza; lo no informado queda vacío", () => {
  const { fields: saved } = fields({ tooth: "3.6" });
  assert.deepEqual(saved, { tooth: "3.6", phase: "", brand: "", system: "", connection: "", diameter: null, length: null, placedOn: "", torque: null, isq: null, productId: null, note: "" });
  assert.ok(fields({ brand: "X" }).error);
});

test("implantes: medidas con coma decimal; fuera de rango o ilegible se avisa en vez de descartarse", () => {
  const { fields: saved } = fields({ tooth: "46", diameter: "4,1", length: "10", torque: "35", isq: "72", phase: "cirugia", placedOn: today });
  assert.deepEqual([saved.diameter, saved.length, saved.torque, saved.isq, saved.phase], [4.1, 10, 35, 72, "cirugia"]);
  for (const bad of [{ diameter: "41" }, { diameter: "4 mm" }, { length: "1" }, { torque: "400" }, { isq: "0" }, { placedOn: "2027-01-01" }, { placedOn: "ayer" }]) assert.ok(fields({ tooth: "46", ...bad }).error, JSON.stringify(bad));
  assert.equal(fields({ tooth: "46", phase: "fracasado" }).fields.phase, "");
});

test("implantes: imágenes guardadas sin duplicados ni datos dañados", () => {
  assert.equal(cleanImplantImage({ imageId: 3, view: "Otra" }), null);
  assert.equal(cleanImplantImage({ imageId: -1, view: "Axial" }), null);
  assert.deepEqual(parseImplantImages('[{"imageId":3,"view":"Axial"},{"imageId":3,"view":"Axial"},{"imageId":"x"}]'), [{ imageId: 3, view: "Axial" }]);
  assert.deepEqual(parseImplantImages("no es json"), []);
  assert.equal(imageKindForView("Radiografía"), "Radiografía");
  assert.equal(imageKindForView("Transversal"), "Captura CBCT");
});

test("implantes: propone fichas desde etiquetas y odontograma, sin repetir las que ya existen", () => {
  const labels = [
    { id: 1, tooth: "3.6", brand: "Marca A", reference: "", lot: "L1", serial: "", placedOn: "2026-11-20" },
    { id: 2, tooth: "", brand: "Sin pieza", reference: "", lot: "L2", serial: "", placedOn: "2026-11-20" },
    { id: 3, tooth: "1.1", brand: "Ya fichado", reference: "", lot: "L3", serial: "", placedOn: "2026-11-20" },
  ];
  const out = implantSuggestions({ implants: [{ tooth: "1.1", productId: 3 }], labels, teeth: { 11: "Implante", 36: "Implante", 46: "Implante con pilar", 47: "Ausente" }, crowns: { 25: { foundation: "implant" }, 26: { foundation: "tooth" } } });
  assert.deepEqual(out.map(item => [item.tooth, item.source]), [["3.6", "etiqueta"], ["2.5", "odontograma"], ["4.6", "odontograma"]]);
  assert.deepEqual(out[0].draft, { tooth: "3.6", brand: "Marca A", placedOn: "2026-11-20", productId: 1, phase: "cirugia" });
  assert.deepEqual(out[1].draft, { tooth: "2.5" });
});

test("implantes: resumen y respaldo incluyen solo lo registrado", () => {
  assert.equal(implantSummary({ brand: "", system: "", diameter: null, length: null }), "");
  assert.equal(implantSummary({ brand: "Marca A", system: "Cónico", diameter: 4.1, length: 10 }), "Marca A Cónico · 4,1 × 10 mm");
  const row = { id: 7, tooth: "3.6", phase: "cirugia", brand: "Marca A", system: "", diameter: 4.1, length: 10, placedOn: today, torque: 35, isq: null, productId: null, note: "", images: '[{"imageId":3,"view":"Axial"},{"imageId":9,"view":"Axial"}]', createdByName: "Dr. Prueba", createdAt: today, updatedAt: today, ownerId: "secreto" };
  const saved = backupImplant(row, new Set([3]));
  assert.deepEqual(saved.images, [{ imageId: 3, view: "Axial" }]);
  assert.equal("ownerId" in saved, false);
  const base = { patient: { id: 1, name: "Paciente Ficticio" }, evolutions: [], budgets: [], appointments: [], periodontalExams: [], odontogram: null, imageMetadata: [] };
  assert.doesNotMatch(fichaMarkdown(base), /## Implantes/);
  const markdown = fichaMarkdown({ ...base, implants: [saved] });
  assert.match(markdown, /## Implantes/);
  assert.match(markdown, /\*\*3\.6\*\* · Cirugía · Marca A · 4,1 × 10 mm · instalado 24-11-2026 · torque 35 Ncm · imágenes: Axial \(adjunto 3\)/);
  assert.doesNotMatch(markdown, /ISQ/);
  const traced = fichaMarkdown({ ...base, implants: [{ ...saved, productId: 5 }], biomedicalProducts: [{ id: 5, reference: "R1", lot: "L1", serial: "" }] });
  assert.match(traced, /etiqueta: ref\. R1, lote L1/);
});

test("implantes: la migración 0027 solo agrega la tabla, la 0029 solo columnas, y ambas coinciden con el esquema", () => {
  const sql = read("drizzle/0027_implants.sql");
  assert.doesNotMatch(sql, /\b(DROP|ALTER|DELETE|UPDATE)\s+(TABLE|FROM|`)/i);
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE patients (id integer PRIMARY KEY)");
  for (let round = 0; round < 2; round++) for (const statement of sql.split("--> statement-breakpoint")) db.exec(statement);
  db.exec("INSERT INTO patients (id) VALUES (1)");
  db.exec("INSERT INTO implants (owner_id, patient_id, tooth, phase, created_by, created_at, updated_at) VALUES ('a', 1, '3.6', 'cirugia', 'a', 'x', 'x')");
  const added = read("drizzle/0029_implant_connection_history.sql");
  assert.doesNotMatch(added, /\b(DROP|DELETE|UPDATE)\s+(TABLE|FROM|`)/i);
  for (const statement of added.split("--> statement-breakpoint")) db.exec(statement);
  // Un implante que ya existía queda con su etapa, sin conexión y sin historial inventado.
  assert.deepEqual({ ...db.prepare("SELECT phase, connection, history FROM implants").get() }, { phase: "cirugia", connection: "", history: "[]" });
  const columns = db.prepare("PRAGMA table_info(implants)").all().map(column => column.name);
  const schema = read("db/schema.ts").split('sqliteTable("implants"')[1].split("implants_patient_idx")[0];
  const declared = [...schema.matchAll(/(?:text|integer|real)\("([a-z_]+)"/g)].map(match => match[1]);
  assert.deepEqual([...columns].sort(), declared.sort());
  const journal = JSON.parse(read("drizzle/meta/_journal.json"));
  assert.ok(journal.entries.some(entry => entry.tag === "0027_implants" && entry.idx === 27));
  assert.ok(journal.entries.some(entry => entry.tag === "0029_implant_connection_history" && entry.idx === 29));
});

test("implantes: permisos, pestaña, respaldo, descarga y capturadora conectados", () => {
  for (const role of ["recepcion", "asistente"]) {
    assert.equal(tabAllowed(role, "implantologia"), false);
    for (const method of ["GET", "POST", "PATCH", "DELETE"]) assert.ok(apiDenied(role, method, "/api/implantes"));
  }
  assert.equal(tabAllowed("dentista", "implantologia"), true);
  const route = read("app/api/implantes/route.ts");
  assert.match(route, /Origen no permitido/);
  assert.match(route, /eq\(clinicalImages\.patientId, current\.patientId\)/);
  assert.match(route, /eq\(biomedicalProducts\.patientId, patientId\)/);
  const page = read("app/page.tsx");
  assert.match(page, /value:"implantologia"/);
  assert.match(page, /showCapturer=\{isDeveloper\}/);
  assert.match(read("app/drive-backup.ts"), /implantRows\.length \?/);
  assert.match(read("app/api/clinical/export/route.ts"), /implantRows/);
  for (const file of ["app/drive-backup.ts", "app/api/clinical/export/route.ts"]) assert.doesNotMatch(read(file), /from\(implants\)[^\n]*\.catch|queries\.implants\)\.catch/, "los implantes no se omiten en silencio");
  assert.match(route, /eq\(implants\.images, current\.images\)/, "dos cambios de imágenes no se pisan");
  const panel = read("components/implantology.tsx");
  assert.match(panel, /¿Desea eliminar/);
  assert.match(panel, /\/descargas\/capturadora-speakdent-prueba\.zip/);
  assert.ok(existsSync(new URL("../public/descargas/capturadora-speakdent-prueba.zip", import.meta.url)));
});

test("implantes: la herramienta Producto está en la ventana del implante y no mezcla piezas", () => {
  const panel = read("components/implantology.tsx");
  assert.match(panel, /<BiomedicalProducts key=\{visit\} embedded compact/);
  assert.match(panel, /tool=\{productTool\} patient=\{patient\} startTooth=\{draft\.tooth\}/);
  assert.match(panel, /!same\[0\]!\.productId/, "solo se une sola a un implante sin etiqueta");
  assert.match(read("components/biomedical-products.tsx"), /Primero guarda o descarta el producto/);
  assert.match(read("app/page.tsx"), /onImageGone=\{productImageGone\} onChanged/);
});
