import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { addedStageNote, backupImplant, cleanImplantFields, cleanImplantImage, imageKindForView, implantSuggestions, implantSummary, implantTooth, parseImplantImages, stageEvolutionEntry } from "../lib/implants.ts";
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
  db.exec("CREATE TABLE biomedical_products (id integer PRIMARY KEY)");
  for (const statement of read("drizzle/0030_implant_stage_records.sql").split("--> statement-breakpoint")) db.exec(statement);
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

test("implantes: la migración 0031 solo agrega columnas a evolutions y coincide con el esquema", () => {
  const sql = read("drizzle/0031_evolution_implant_stage.sql");
  assert.doesNotMatch(sql, /\b(DROP|DELETE|UPDATE)\s+(TABLE|FROM|`)/i);
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE patients (id integer PRIMARY KEY)");
  db.exec("CREATE TABLE implants (id integer PRIMARY KEY)");
  db.exec(`CREATE TABLE evolutions (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, owner_id text NOT NULL, patient_id integer NOT NULL,
    clinical_date text NOT NULL, recorded_at text NOT NULL, title text NOT NULL, body text NOT NULL, source_document_id text,
    backup_status text DEFAULT 'not_configured' NOT NULL, request_id text, status text DEFAULT 'vigente' NOT NULL,
    annulled_at text, annulled_by text, annul_reason text, replaces_id integer)`);
  db.exec("INSERT INTO patients (id) VALUES (1)");
  db.exec("INSERT INTO implants (id) VALUES (1)");
  db.exec("INSERT INTO evolutions (owner_id, patient_id, clinical_date, recorded_at, title, body) VALUES ('a', 1, '2026-11-25', 'x', 't', 'b')");
  for (const statement of sql.split("--> statement-breakpoint")) db.exec(statement);
  // Una evolución que ya existía (de la ficha general) queda sin implante ni fase: no es de implantología.
  assert.deepEqual({ ...db.prepare("SELECT implant_id, stage_phase FROM evolutions").get() }, { implant_id: null, stage_phase: null });
  db.exec("UPDATE evolutions SET implant_id = 1, stage_phase = 'cirugia' WHERE id = 1");
  assert.deepEqual({ ...db.prepare("SELECT implant_id, stage_phase FROM evolutions").get() }, { implant_id: 1, stage_phase: "cirugia" });
  const columns = db.prepare("PRAGMA table_info(evolutions)").all().map(column => column.name);
  const schema = read("db/schema.ts").split('sqliteTable("evolutions"')[1].split("evolutions_patient_date_idx")[0];
  const declared = [...schema.matchAll(/(?:text|integer|real)\("([a-z_]+)"/g)].map(match => match[1]);
  assert.deepEqual([...columns].sort(), declared.sort());
  const journal = JSON.parse(read("drizzle/meta/_journal.json"));
  assert.ok(journal.entries.some(entry => entry.tag === "0031_evolution_implant_stage" && entry.idx === 31));
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
  assert.match(page, /showCapturer=\{true\}/, "la capturadora ya no queda oculta tras el panel de desarrollador");
  assert.match(read("app/drive-backup.ts"), /implantRows\.length \?/);
  assert.match(read("app/api/clinical/export/route.ts"), /implantRows/);
  for (const file of ["app/drive-backup.ts", "app/api/clinical/export/route.ts"]) assert.doesNotMatch(read(file), /from\(implants\)[^\n]*\.catch|queries\.implants\)\.catch/, "los implantes no se omiten en silencio");
  assert.match(route, /eq\(implants\.images, current\.images\)/, "dos cambios de imágenes no se pisan");
  const panel = read("components/implantology.tsx");
  assert.match(panel, /¿Desea eliminar/);
  assert.match(panel, /\/descargas\/capturadora-speakdent-prueba\.zip/);
  assert.ok(existsSync(new URL("../public/descargas/capturadora-speakdent-prueba.zip", import.meta.url)));
});

test("implantes: la etapa se puede dictar, con redacción ordenada y sin voz", () => {
  const sheet = read("components/implant-sheet.tsx");
  assert.match(sheet, /import \{ StageDictation \} from "@\/components\/stage-dictation"/);
  assert.match(sheet, /<StageDictation disabled=\{busy\} onInsert=\{insertDictation\}/);
  assert.match(sheet, /const insertDictation = \(text: string\) => \{/, "el dictado se agrega a lo que se está por agregar, no lo reemplaza");
  assert.match(sheet, /\[draftAddition, text\]\.filter\(Boolean\)\.join\("\\n\\n"\)/, "cada dictado se suma a lo que ya se había escrito o dictado en esta sesión, sin perderlo");
  const dictation = read("components/stage-dictation.tsx");
  assert.match(dictation, /createAudioTranscription/);
  assert.match(dictation, /useTextCorrection/);
  assert.match(dictation, /correction\.result\?\.text/, "si no hay redacción, se puede agregar igual la transcripción corregida");
  assert.match(dictation, /redraftedNote/, "el dictado del profesional suele salir desordenado: se ofrece la nota ya redactada");
  assert.match(dictation, /stage-dictation-insert-raw/, "la transcripción corregida sigue disponible además de la redactada");
  assert.doesNotMatch(dictation, /speakAlerts|🔊|SpeechSynthesis/i, "sin voz correctiva: sin alertas habladas");
  assert.match(dictation, /border-2 border-red-600 bg-red-600/, "reutiliza el letrero rojo de rectificación ya usado en el dictado clínico");
  assert.match(dictation, /rectificando|rectificaci/i);
  assert.match(dictation, /data-testid="stage-dictation-mic"/);
});

test("implantes: la nota de la etapa es su propia evolución fechada, con la misma barra de accesos directos que la evolución general", () => {
  const sheet = read("components/implant-sheet.tsx");
  assert.doesNotMatch(sheet, /noteOpen|stage-note-row|stage-note-preview|stage-note-canvas/, "ya no es una nota comprimida que se abre a lienzo: es una evolución más, no una nota aparte");
  assert.match(sheet, /import \{ EvolutionHistory, type EvolutionHistoryNote \} from "@\/components\/evolution-history"/, "reutiliza el mismo historial que la evolución general, no uno propio");
  assert.match(sheet, /const draftAddition = edit\.note \?\? ""/, "lo escrito es solo lo nuevo por agregar, no la nota acumulada");
  assert.match(sheet, /data-testid="stage-note-compose"/, "una caja breve para agregar, no un campo que muestra todo lo acumulado");
  assert.match(sheet, /data-testid="stage-note-save">Agregar a la evolución</, "cada guardado agrega una evolución más, nunca la reemplaza");
  assert.match(sheet, /<EvolutionHistory notes=\{evolutions\} allNotes=\{allEvolutions\} odontogram=\{odontogram\} onSyncOdontogram=\{onSyncOdontogram\} onAnnul=\{onAnnulEvolution\} onEdit=\{onEditEvolution\} rail=\{evolutionRail\}\/>/, "misma vista y misma barra que la evolución general, dentro del propio módulo");
  assert.match(sheet, /onNote: \(\) => void/, "guardar ya no reemplaza una nota: solo agrega, sin «was» para reemplazar");
  assert.doesNotMatch(sheet, /Reemplazar con la mía/, "ya no se puede reemplazar lo que escribió otro: solo agregar después o descartar lo propio");
  // Lo anotado antes de este cambio (sin evolución propia vinculada) no desaparece: se muestra aparte, solo lectura, sin inventarle fecha.
  assert.match(sheet, /\{!evolutions\.length && saved\.trim\(\) !== "" && <div[^>]*data-testid="stage-legacy-note"/, "las notas de fases ya marcadas antes de este cambio se siguen viendo, no se esconden");
});

test("implantes: la pantalla de implantología pasa la barra de accesos directos y el odontograma, con valores por defecto para seguir funcionando sola", () => {
  const panel = read("components/implantology.tsx");
  assert.match(panel, /evolutionRail, odontogram = emptyOdontogram\(\), onSyncOdontogram = async \(\) => \{\}, onEditEvolution, onAnnulEvolution = \(\) => \{\}/, "props opcionales con valores por defecto que no hacen nada (p. ej. para el arnés de pruebas)");
  assert.match(panel, /evolutions=\{evolutions\.filter\(n => n\.implantId === current\.id && n\.stagePhase === stage\.phase\)\}/, "cada etapa muestra solo sus propias evoluciones");
  assert.match(panel, /onNote=\{\(\) => void saveNote\(\)\}/, "ya no se pasa un «was» a reemplazar");
  assert.match(read("app/page.tsx"), /evolutionRail=\{\(note,latest\)=>buildRail\(patient,note,latest\)\}\n\s*odontogram=\{toothStatuses\[selectedId\] \?\? emptyOdontogram\(\)\}\n\s*onSyncOdontogram=\{syncEvolutionOdontogram\}\n\s*onEditEvolution=\{editEvolution\}\n\s*onAnnulEvolution=\{note=>setAnnulTarget\(note\)\}/, "la ficha conecta implantología con la misma barra, el mismo odontograma y el mismo anular/editar que usa la evolución general");
  // Este panel lee sus evoluciones con su propio `load()` (aparte de las de app/page.tsx): si no refresca su
  // estado tras editar, la etapa vuelve a mostrar lo viejo al cerrar el editor.
  assert.match(panel, /const editEvolutionHere = onEditEvolution && \(async \(note: EvolutionHistoryNote, title: string, body: string\) => \{/, "envuelve onEditEvolution para refrescar también el estado propio del panel");
  assert.match(panel, /setEvolutions\(previous => previous\.map\(n => n\.id === note\.id \? \{ \.\.\.n, title, body \} : n\)\)/, "la evolución editada se actualiza en el estado del panel, no solo en el de la ficha");
  assert.match(panel, /onEditEvolution=\{editEvolutionHere\}/, "la etapa recibe el wrapper, no el onEditEvolution crudo");
});

test("implantes: marcar la etapa con la fecha elegida va antes de guardar la nota, para no fechar en «hoy» por falta de marca", () => {
  const panel = read("components/implantology.tsx");
  const saveNote = panel.slice(panel.indexOf("const saveNote = async () => {"), panel.indexOf("const addStageImages = async"));
  const markedAt = saveNote.indexOf("await ensureMarked(id, phase, date);");
  const sentAt = saveNote.indexOf('await send<{ implant: Implant }>("PATCH", { id, stageNote:');
  assert.ok(markedAt > -1 && sentAt > -1 && markedAt < sentAt, "ensureMarked debe llamarse antes de enviar la nota, no después");
});

test("implantes: un implante borrado no se lleva sus evoluciones (solo deja de estar vinculado)", () => {
  assert.match(read("db/schema.ts"), /implantId: integer\("implant_id"\)\.references\(\(\) => implants\.id, \{ onDelete: "set null" \}\)/, "borrar el implante no debe bloquearse por tener evoluciones vinculadas");
  assert.match(read("drizzle/0031_evolution_implant_stage.sql"), /REFERENCES `implants`\(`id`\) ON DELETE SET NULL/, "la migración declara el mismo comportamiento que el esquema");
});

test("implantes: el diálogo de anular una evolución de una etapa queda encima de la ficha del implante", () => {
  assert.match(read("components/ui/dialog.tsx"), /overlayClassName\?: string/, "DialogContent acepta subir también el z-index del fondo, no solo el del contenido");
  const annul = read("components/evolution-annul.tsx");
  assert.match(annul, /<DialogContent className="z-\[90\][^"]*" overlayClassName="z-\[90\]"/, "z-[90] > z-[80] de la ficha de implante: el diálogo de anular no queda tapado al abrirse desde una etapa");
});

test("implantes: lo agregado a la nota de una fase se detecta sin repetir lo que ya estaba", () => {
  assert.equal(addedStageNote("", "Primer registro"), "Primer registro");
  assert.equal(addedStageNote("Primer registro", "Primer registro\n\n— 25-11-2026 —\nSe instaló el implante"), "— 25-11-2026 —\nSe instaló el implante", "solo lo nuevo, sin repetir lo ya guardado");
  assert.equal(addedStageNote("Algo largo que escribí antes", "Nota corregida distinta"), "Nota corregida distinta", "si no creció a partir de lo anterior, se compila completa (se corrigió, no se sumó)");
  assert.equal(addedStageNote("Lo mismo", "Lo mismo"), "", "sin nada nuevo no hay nada que compilar");
  assert.equal(addedStageNote("Algo", ""), "", "una nota que quedó vacía no genera una evolución");
});

test("implantes: lo trabajado en una fase se compila para la evolución general del paciente", () => {
  const entry = stageEvolutionEntry({
    tooth: "1.1", phaseId: "cirugia",
    implant: { brand: "Straumann", system: "BLT", diameter: 4.1, length: 10 },
    connection: "conica",
    pieces: [{ kind: "Implante", category: "implante" }, { kind: "", category: "pilar" }],
    addedNote: "— 25-11-2026 —\nSe instaló sin incidentes",
  });
  assert.ok(entry);
  assert.match(entry.title, /Implantología · pieza 1\.1 · Cirugía/);
  assert.match(entry.body, /Straumann BLT · 4,1 × 10 mm/, "las medidas del implante se compilan");
  assert.match(entry.body, /Conexión cónica/, "la conexión se compila");
  assert.match(entry.body, /Piezas: Implante · Pilar/, "las piezas usadas en la fase se compilan");
  assert.match(entry.body, /Se instaló sin incidentes/, "lo nuevo de la nota se compila, no lo ya agregado antes");
  assert.equal(stageEvolutionEntry({ tooth: "1.1", phaseId: "cirugia", implant: {}, connection: "", pieces: [], addedNote: "" }), null, "sin nada nuevo que agregar, no hay evolución que compilar");
  // Si por algún motivo lo guardado fuera el código compacto (sin punto), el título igual queda en FDI con punto.
  assert.match(stageEvolutionEntry({ tooth: "12", phaseId: "cirugia", implant: {}, connection: "", pieces: [], addedNote: "algo" }).title, /pieza 1\.2/);
});

test("implantes: la nota de una fase se compila y se suma a la evolución general del paciente", () => {
  const route = read("app/api/implantes/route.ts");
  assert.match(route, /import \{ authorStatement \} from "@\/app\/evolution-author"/, "reutiliza el registro de autor ya usado en evolución clínica, no lo duplica");
  assert.match(route, /addedStageNote\(cleanStageNote\(was\), edited\.notes\[phase\] \?\? ""\)/, "solo se compila lo nuevo de la nota");
  assert.match(route, /stagePieces\(products, current, phase\)/, "las piezas de esa fase se incluyen en lo compilado");
  assert.match(route, /stageEvolutionEntry\(\{/);
  assert.match(route, /db\.insert\(evolutions\)\.values\(\{ ownerId, patientId: row\.patientId,.*title: pendingEvolution\.title, body: pendingEvolution\.body.*implantId: row\.id, stagePhase: pendingEvolutionPhase/, "se agrega como una evolución nueva, vinculada a su implante y fase (no se reemplaza ninguna)");
  assert.match(route, /\(await authorStatement\(db, ownerId\)\)\.statement/, "el autor se registra en el mismo batch: si no se puede registrar, tampoco se guarda la evolución");
  assert.match(route, /if \(row && pendingEvolution && pendingEvolutionPhase\)/, "solo se compila si la nota del implante quedó guardada");
  // Si falla el batch de evolución+autor, no se traga en silencio (antes `.catch(() => undefined)` dejaba
  // que igual se respondiera éxito aunque la evolución no quedara guardada).
  assert.doesNotMatch(route, /db\.insert\(evolutions\)\.values\(\{ ownerId, patientId: row\.patientId,[\s\S]{0,400}\]\)\.catch/, "un fallo al compilar la evolución no se oculta: debe propagarse y responder error");
});

test("implantes: la ficha devuelve las evoluciones que compiló cada implante, con la misma forma que la evolución general", () => {
  const route = read("app/api/implantes/route.ts");
  assert.match(route, /import \{ annulView, displayDate \} from "@\/app\/evolution-view"/, "reutiliza el mismo formato de fecha y de anulación que usa la evolución general");
  assert.match(route, /import \{ authorsOf, type TeamDb \} from "@\/app\/clinic-team-db"/);
  assert.match(route, /import \{ evolutionAuthor \} from "@\/lib\/clinic-team"/);
  assert.match(route, /async function stageEvolutionsOf\(/, "arma el historial de evoluciones del implante aparte, reutilizable en el GET");
  assert.match(route, /isNotNull\(evolutions\.implantId\)/, "solo las evoluciones que vienen de un implante de este paciente");
  assert.match(route, /id: n\.id, patientId: n\.patientId, date: displayDate\(n\.clinicalDate\), clinicalDate: n\.clinicalDate, recordedAt: n\.recordedAt/, "misma forma que una nota de evolución general (EvolutionHistoryNote)");
  assert.match(route, /authorName: authorRow\?\.author_name \|\| "", authorEmail: authorRow\?\.author_email \|\| "", mine: authorId === personalId/, "autoría igual que en evolución general, para que la barra sepa si es propia");
  assert.match(route, /\.\.\.annulView\(n\)/, "estado de vigente\/anulada igual que en evolución general");
  assert.match(route, /evolutions: stageEvolutions/, "el GET expone el arreglo ya armado");
  const clinicalRoute = read("app/api/clinical/route.ts");
  assert.match(clinicalRoute, /import \{ annulView, displayDate \} from "@\/app\/evolution-view"/, "la evolución general usa el mismo módulo compartido, no una copia propia");
  assert.doesNotMatch(clinicalRoute, /^const displayDate = |^function annulView\(/m, "ya no define su propia copia de estas funciones");
});

test("implantes: la herramienta Producto está en la ventana del implante y no mezcla piezas", () => {
  const panel = read("components/implantology.tsx");
  assert.match(panel, /<BiomedicalProducts key=\{visit\} embedded compact/);
  assert.match(panel, /tool=\{productTool\} patient=\{patient\} startTooth=\{draft\.tooth\}/);
  assert.match(panel, /!same\[0\]!\.productId/, "solo se une sola a un implante sin etiqueta");
  assert.match(read("components/biomedical-products.tsx"), /Primero guarda o descarta el producto/);
  assert.match(read("app/page.tsx"), /onImageGone=\{productImageGone\} onChanged/);
});
