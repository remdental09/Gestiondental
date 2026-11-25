import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { MAX_STAGE_NOTE, backupImplant, cleanImplantImage, imageKindForView, isCutView, parseImplantImages, parseStageNotes, setStageNote } from "../lib/implants.ts";
import { PIECE_KINDS, categoryKind, kindCategory, loosePieces, pieceKind, pieceKindOptions, pieceSummary, stagePieces } from "../lib/implant-pieces.ts";
import { cleanProductFields, labelExtras, parseLabelReading, productFigureLines, productFigureTitle } from "../lib/biomedical-products.ts";
import { applyPhoto } from "../lib/product-draft.ts";
import { fichaMarkdown } from "../lib/backup-markdown.ts";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const piece = (id, extra = {}) => ({ id, implantId: null, stage: "", kind: "", category: "otro", tooth: "3.6", ...extra });
const implant = { id: 1, tooth: "3.6", productId: null };

test("tipos de pieza: la lista es abierta, recuerda los nuevos y no repite", () => {
  const options = pieceKindOptions(["pilar", "Multi-unit", "Análogo", "analogo", " ", "Multi-unit"]);
  assert.deepEqual(options, [...PIECE_KINDS, "Multi-unit"]);
  for (const [kind, category] of [["Implante", "implante"], ["Implante cigomático", "implante"], ["Pilar", "pilar"], ["Tornillo", "pilar"], ["Cicatrizador", "pilar"], ["Scan body", "pilar"], ["Transfer", "pilar"], ["Análogo", "pilar"], ["Injerto", "injerto"], ["Membrana", "membrana"], ["Sutura", "sutura"], ["Material", "otro"], ["Corona", "otro"], ["Multi-unit", "otro"], ["", "otro"]])
    assert.equal(kindCategory(kind), category, kind);
  assert.equal(categoryKind("otro"), "");
  assert.equal(pieceKind({ kind: "", category: "pilar" }), "Pilar");
  assert.equal(pieceKind({ kind: "", category: "otro" }), "Otro");
});

test("fases: cualquier fase admite cualquier pieza y cada una muestra solo lo suyo", () => {
  const all = [
    piece(3, { implantId: 1, stage: "cirugia", kind: "Material" }), piece(1, { implantId: 1, stage: "cirugia", kind: "Implante", category: "implante" }),
    piece(2, { implantId: 1, stage: "cirugia", kind: "Pilar" }), piece(4, { implantId: 1, stage: "rehabilitacion", kind: "Pilar" }), piece(5, { implantId: 2, stage: "cirugia", kind: "Implante" }),
  ];
  assert.deepEqual(stagePieces(all, implant, "cirugia").map(item => item.id), [1, 2, 3]);
  assert.deepEqual(stagePieces(all, implant, "rehabilitacion").map(item => item.id), [4]);
  assert.deepEqual(stagePieces(all, implant, "conexion"), []);
  assert.equal(pieceSummary([...stagePieces(all, implant, "cirugia"), piece(9, { kind: "Pilar" })]), "Implante · Pilar ×2 · Material");
});

test("registros anteriores: la etiqueta unida se ve en Cirugía; lo suelto de la pieza se ofrece, nunca lo de otro implante", () => {
  const linked = { id: 1, tooth: "3.6", productId: 7 }, other = { id: 2, tooth: "3.6", productId: 8 };
  const all = [piece(7, { category: "implante" }), piece(8, { category: "implante" }), piece(9), piece(10, { tooth: "4.6" }), piece(11, { implantId: 2, stage: "cirugia" })];
  assert.deepEqual(stagePieces(all, linked, "cirugia").map(item => item.id), [7]);
  assert.deepEqual(stagePieces(all, linked, "conexion"), []);
  assert.deepEqual(loosePieces(all, linked, [linked, other]).map(item => item.id), [9]);
  // Una vez puesta en otra fase, la etiqueta deja de repetirse en Cirugía.
  assert.deepEqual(stagePieces([piece(7, { implantId: 1, stage: "conexion" })], linked, "cirugia"), []);
});

test("nota por fase: varias líneas, se borra al vaciarla y no pisa una escrita en otro lado", () => {
  assert.deepEqual(parseStageNotes('{"cirugia":" a ","otra":"x","plan":5}'), { cirugia: "a" });
  assert.deepEqual(parseStageNotes("[1]"), {});
  assert.deepEqual(parseStageNotes("no es json"), {});
  const first = setStageNote("{}", { phase: "cirugia", was: "", note: "Provisorio en resina.\r\nSin carga oclusal." });
  assert.deepEqual(first.notes, { cirugia: "Provisorio en resina.\nSin carga oclusal." });
  const raw = JSON.stringify(first.notes);
  assert.equal(setStageNote(raw, { phase: "cirugia", was: "", note: "otra" }).stale, true);
  assert.deepEqual(setStageNote(raw, { phase: "conexion", was: "", note: "ok" }).notes, { ...first.notes, conexion: "ok" });
  assert.deepEqual(setStageNote(raw, { phase: "cirugia", was: first.notes.cirugia, note: "  " }).notes, {});
  assert.ok(setStageNote(raw, { phase: "cirugia", was: first.notes.cirugia, note: "x".repeat(MAX_STAGE_NOTE + 1) }).error);
  assert.ok(setStageNote(raw, { phase: "fracaso", was: "", note: "x" }).error);
  assert.ok(setStageNote(raw, { phase: "plan", note: 3 }).error);
});

test("imágenes: la fase queda guardada; las anteriores siguen sin fase; la foto clínica no es un corte", () => {
  assert.deepEqual(cleanImplantImage({ imageId: 3, view: "Foto clínica", stage: "cirugia" }), { imageId: 3, view: "Foto clínica", stage: "cirugia" });
  assert.deepEqual(cleanImplantImage({ imageId: 3, view: "Axial", stage: "otra" }), { imageId: 3, view: "Axial" });
  assert.deepEqual(parseImplantImages('[{"imageId":1,"view":"Axial"},{"imageId":2,"view":"Radiografía","stage":"conexion"}]'), [{ imageId: 1, view: "Axial" }, { imageId: 2, view: "Radiografía", stage: "conexion" }]);
  assert.equal(imageKindForView("Foto clínica"), "Foto clínica");
  assert.deepEqual(["Axial", "Radiografía", "Foto clínica"].map(isCutView), [true, false, false]);
  assert.match(read("app/api/images/route.ts"), /"Foto clínica"\]\.includes/);
});

test("pieza: lo escrito a mano y el tipo abierto se guardan; sin tipo no se inventa", () => {
  assert.equal(cleanProductFields({ category: "otro", kind: "  Multi-unit  ", placedOn: "2026-11-25" }, "2026-11-25").kind, "Multi-unit");
  const plain = cleanProductFields({ category: "implante", brand: "Marca A" }, "2026-11-25");
  assert.equal(plain.kind, "");
  assert.equal("kind" in labelExtras(plain), false, "un producto anterior queda igual en el respaldo");
});

test("foto: el tipo se propone aunque no haya texto legible, sin inventar datos ni pisar lo escrito", () => {
  assert.deepEqual(parseLabelReading({ legible: false, kind: "Scan body", lot: "X1", brand: "M" }), { legible: false, kind: "Scan body" });
  const empty = { kind: "", brand: "", model: "", diameter: "", length: "", reference: "", lot: "", serial: "", manufactured: "", expiry: "", manufacturer: "", registration: "", gtin: "", details: [], code: "", category: "implante", categoryBy: "", suggested: new Set(), fromCode: new Set(), scan: null };
  const proposed = applyPhoto(empty, null, { legible: false, kind: "Scan body" }).draft;
  assert.equal(proposed.kind, "Scan body");
  assert.ok(proposed.suggested.has("kind"), "queda marcado para confirmar");
  assert.equal(applyPhoto({ ...empty, kind: "Transfer" }, null, { legible: true, kind: "Pilar" }).draft.kind, "Transfer");
  assert.equal(applyPhoto(proposed, null, { legible: true, brand: "M" }).draft.kind, "", "al cambiar la foto se quita lo propuesto");
});

test("respaldo: cada fase con lo que se usó y su nota; un implante sin nada nuevo queda igual", () => {
  const row = { id: 1, tooth: "3.6", phase: "cirugia", brand: "", system: "", connection: "", diameter: null, length: null, placedOn: "2026-11-25", torque: null, isq: null, productId: null, note: "", images: "[]", history: '[{"phase":"cirugia","date":"2026-11-25"}]', createdByName: "", createdAt: "x", updatedAt: "x" };
  assert.equal("stageNotes" in backupImplant({ ...row, stageNotes: "{}" }), false);
  const saved = backupImplant({ ...row, stageNotes: '{"cirugia":"Carga inmediata"}', images: '[{"imageId":5,"view":"Radiografía","stage":"cirugia"}]' });
  assert.deepEqual(saved.stageNotes, { cirugia: "Carga inmediata" });
  const base = { patient: { id: 1, name: "Paciente Ficticio" }, evolutions: [], budgets: [], appointments: [], periodontalExams: [], odontogram: null, imageMetadata: [] };
  const text = fichaMarkdown({ ...base, implants: [saved], biomedicalProducts: [
    { id: 11, category: "implante", kind: "Implante", brand: "Marca A", lot: "L-1", tooth: "3.6", implantId: 1, stage: "cirugia", placedOn: "2026-11-25" },
    { id: 12, category: "otro", kind: "Material", model: "Resina provisoria", tooth: "3.6", implantId: 1, stage: "cirugia", placedOn: "2026-11-25" },
    { id: 13, category: "pilar", kind: "Scan body", tooth: "3.6", implantId: 1, stage: "rehabilitacion", placedOn: "2026-11-25" },
  ] });
  assert.match(text, /\n  - Cirugía: Implante, Marca A, lote L-1; Material, Resina provisoria · nota: Carga inmediata\n  - Rehabilitación: Scan body\n/);
  assert.match(text, /Radiografía de Cirugía \(adjunto 5\)/);
  assert.match(text, /\*\*Scan body\*\*.*Fase del implante: Rehabilitación/);
  const old = fichaMarkdown({ ...base, implants: [backupImplant(row)] });
  assert.doesNotMatch(old, /\n  - /);
  assert.match(read("app/drive-backup.ts"), /p\.implantId \? \{ implantId: p\.implantId, stage: p\.stage \} : \{\}/);
});

test("documento de trazabilidad: dice qué es y en qué fase se usó", () => {
  assert.equal(productFigureTitle(1, { brand: "Marca A", tooth: "3.6", kind: "Transfer" }, "Pilar, tornillo o aditamento"), "1. Transfer · Marca A — pieza 3.6");
  assert.ok(productFigureLines({ reference: "", lot: "", serial: "", expiry: "", manufacturer: "", note: "", placedOnLabel: "hoy", stageLabel: "Conexión de implante" }).includes("Fase del implante: Conexión de implante"));
  assert.match(read("app/products-pdf.ts"), /stageLabel: product\.implantId && product\.stage \? phaseLabel\(product\.stage\) : ""/);
});

test("migración 0030: solo agrega columnas; lo guardado queda sin fase ni nota", () => {
  const sql = read("drizzle/0030_implant_stage_records.sql");
  assert.doesNotMatch(sql, /\b(DROP|UPDATE|DELETE|CREATE)\b/);
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE biomedical_products (id integer PRIMARY KEY, lot text); CREATE TABLE implants (id integer PRIMARY KEY); INSERT INTO biomedical_products VALUES (1,'L'); INSERT INTO implants VALUES (1)");
  for (const statement of sql.split("--> statement-breakpoint")) db.exec(statement);
  assert.deepEqual({ ...db.prepare("SELECT * FROM biomedical_products").get() }, { id: 1, lot: "L", implant_id: null, stage: "", kind: "" });
  assert.deepEqual({ ...db.prepare("SELECT * FROM implants").get() }, { id: 1, stage_notes: "{}" });
  const schema = read("db/schema.ts");
  for (const column of ["implant_id", "stage", "kind", "stage_notes"]) assert.ok(schema.includes(`("${column}")`), column);
  assert.ok(JSON.parse(read("drizzle/meta/_journal.json")).entries.some(entry => entry.tag === "0030_implant_stage_records" && entry.idx === 30));
});

test("API: cada pieza queda en un implante del mismo paciente; borrar o mover no deja enlaces colgando", () => {
  const products = read("app/api/productos/route.ts"), route = read("app/api/implantes/route.ts");
  assert.match(products, /eq\(implants\.id, implantId\), eq\(implants\.ownerId, ownerId\), eq\(implants\.patientId, patientId\)/);
  assert.match(products, /await releaseLabel\(ownerId, id, null\)/);
  assert.match(products, /\(current\.implantId && row\.implantId !== current\.implantId\) \|\| \(wanted && !row\.implantId\)/);
  assert.match(route, /set\(\{ implantId: null, stage: "" \}\)\.where\(and\(eq\(biomedicalProducts\.ownerId, ownerId\), eq\(biomedicalProducts\.implantId, id\)\)\)/);
  assert.match(route, /eq\(biomedicalProducts\.implantId, row\.id\), ne\(biomedicalProducts\.tooth, row\.tooth\)/);
  // Los tipos recordados salen solo de la cuenta propia y sin datos de pacientes.
  assert.match(route, /select\(\{ kind: biomedicalProducts\.kind \}\)\.from\(biomedicalProducts\)\.where\(and\(eq\(biomedicalProducts\.ownerId, ownerId\)/);
});

test("un producto que apunta a un implante eliminado vuelve a ofrecerse en su pieza", () => {
  const all = [piece(1, { implantId: 99, stage: "cirugia" }), piece(2, { implantId: 1, stage: "cirugia" })];
  assert.deepEqual(loosePieces(all, implant, [implant]).map(item => item.id), [1]);
});

test("revisión: lo guardado en otro lado no se pisa sin que el profesional lo vea y lo decida", () => {
  const panel = read("components/implantology.tsx"), sheet = read("components/implant-sheet.tsx");
  // La nota se envía con lo que había al empezar a escribir, no con lo último que se leyó.
  assert.match(panel, /const was = replacing \?\? stage\.noteFrom \?\?/);
  assert.match(sheet, /stage-note-conflict/);
  assert.match(sheet, /stage-date-conflict/);
  // La fecha de instalación ya registrada no se reemplaza al anotar algo, y corregir una nota no vuelve a marcar.
  assert.match(panel, /phase === "cirugia" && target\.placedOn \? target\.placedOn : date/);
  assert.match(panel, /if \(!was && implant\.stageNotes\[phase\]\) await ensureMarked/);
  assert.match(panel, /ensureMarked\(id, phase, product\.placedOn\)/);
  // Lo pegado dentro de una etapa queda en ella.
  assert.match(sheet, /stage-pasted/);
});

test("revisión: mover o sacar una pieza de su fase exige saber dónde estaba y confirmarlo", () => {
  const products = read("app/api/productos/route.ts"), form = read("components/biomedical-products.tsx");
  assert.match(products, /Esta pieza cambió en otro lado/);
  assert.match(products, /body\.toothWas === fields\.tooth\) change\.tooth = current\.tooth/);
  assert.match(products, /body\.unplace !== true\) return fail/);
  assert.match(form, /Al cambiar la pieza dental se quita de esa fase/);
});

test("una fecha dejada en blanco no se convierte en hoy, y dos cambios a la vez no se pisan", () => {
  const products = read("app/api/productos/route.ts"), form = read("components/biomedical-products.tsx");
  assert.match(form, /placedOn: data\.placedOn \|\| \(draft\.id === null \? slot\.date : ""\)/);
  assert.match(products, /place\.implantId && body\.placedOn === ""\) fields\.placedOn = ""/);
  assert.match(products, /isNull\(biomedicalProducts\.implantId\), eq\(biomedicalProducts\.stage, current\.stage\)/);
});

