import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MAX_PHASE_HISTORY, backupImplant, cleanImplantFields, connectionText, mergeImplantEdit, parseHistory, recordPhase, setStage, stageMarks, suggestConnection } from "../lib/implants.ts";
import { fichaMarkdown } from "../lib/backup-markdown.ts";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const today = "2026-11-25";
const none = { phase: "", placedOn: "" };
const at = (phase, placedOn = "") => ({ phase, placedOn });

test("conexión: solo las opciones ofrecidas; lo demás queda sin registrar", () => {
  const saved = connection => cleanImplantFields({ tooth: "3.6", connection }, today).fields.connection;
  for (const id of ["hexagono-externo", "hexagono-interno", "conica", "otra"]) assert.equal(saved(id), id);
  for (const bad of ["", "Cónica", "trilobular", 3, undefined]) assert.equal(saved(bad), "");
  assert.equal(connectionText("conica"), "Conexión cónica");
  assert.equal(connectionText(""), "");
});

test("conexión: se propone la confirmada para la misma marca y sistema; nunca por la marca sola ni sin marca", () => {
  const known = [
    { brand: "Marca A", system: "Línea 1", connection: "conica" },
    { brand: "marca a", system: "línea 1", connection: "hexagono-interno" },
    { brand: "Marca A", system: "", connection: "otra" },
    { brand: "", system: "", connection: "hexagono-externo" },
  ];
  assert.equal(suggestConnection(known, " MARCA  A ", "Línea 1"), "conica", "la más reciente");
  assert.equal(suggestConnection(known, "Marca A", ""), "otra");
  assert.equal(suggestConnection(known, "Marca A", "Línea 2"), "");
  assert.equal(suggestConnection(known, "Marca B", "Línea 1"), "");
  assert.equal(suggestConnection(known, "", ""), "");
});

test("historial: la ficha no inventa fechas; la cirugía usa la fecha de instalación", () => {
  assert.deepEqual(recordPhase([], none, at("plan")), [{ phase: "plan", date: "" }]);
  assert.deepEqual(recordPhase([], none, at("mantencion", "2020-03-01")), [{ phase: "mantencion", date: "" }]);
  assert.deepEqual(recordPhase([], none, at("cirugia", "2026-11-20")), [{ phase: "cirugia", date: "2026-11-20" }]);
  assert.deepEqual(recordPhase([], none, at("cirugia")), [{ phase: "cirugia", date: "" }]);
  assert.deepEqual(recordPhase([], none, none), []);
  const history = [{ phase: "plan", date: "2026-11-01" }];
  assert.deepEqual(recordPhase(history, at("plan"), at("plan")), history, "guardar sin cambiar de etapa no agrega nada");
  assert.deepEqual(recordPhase(history, at("plan"), none), history, "dejar sin etapa conserva lo anotado");
  assert.deepEqual(recordPhase(history, none, at("plan")), history, "volver a marcar la misma no la repite");
});

test("historial: un implante anterior conserva su etapa sin inventarle fecha", () => {
  assert.deepEqual(recordPhase([], at("osteointegracion"), at("rehabilitacion")), [{ phase: "osteointegracion", date: "" }, { phase: "rehabilitacion", date: "" }]);
  assert.deepEqual(recordPhase([], at("cirugia", "2026-08-01"), at("osteointegracion", "2026-08-01")), [{ phase: "cirugia", date: "2026-08-01" }, { phase: "osteointegracion", date: "" }]);
});

test("historial: la cirugía sigue a la fecha de instalación corregida, pero no pisa una fecha escrita a mano", () => {
  const history = [{ phase: "cirugia", date: "2026-11-20" }, { phase: "osteointegracion", date: today }];
  const moved = recordPhase(history, at("osteointegracion", "2026-11-20"), at("osteointegracion", "2026-11-18"));
  assert.deepEqual(moved, [{ phase: "cirugia", date: "2026-11-18" }, { phase: "osteointegracion", date: today }]);
  const own = [{ phase: "cirugia", date: "2026-11-02" }];
  assert.deepEqual(recordPhase(own, at("cirugia", "2026-11-20"), at("cirugia", "2026-11-18")), own);
});

test("historial: tiene tope y omite lo dañado", () => {
  let history = [];
  for (let i = 0; i < MAX_PHASE_HISTORY + 5; i++) history = recordPhase(history, at(i % 2 ? "plan" : "evaluacion"), at(i % 2 ? "evaluacion" : "plan"));
  assert.equal(history.length, MAX_PHASE_HISTORY);
  assert.deepEqual(parseHistory('[{"phase":"plan","date":""},{"phase":"x","date":""},{"phase":"plan","date":"ayer"},null]'), [{ phase: "plan", date: "" }]);
  for (const raw of ["no es json", "{}", undefined]) assert.deepEqual(parseHistory(raw), []);
});

const staged = (phase, placedOn = "") => ({ phase, placedOn });
const mark = (history, current, change) => setStage(history, current, change, today);

test("etapas: se marca cualquiera con su fecha, en cualquier orden, y la actual es la más avanzada", () => {
  const surgery = mark([], staged(""), { phase: "cirugia", was: null, date: "2026-11-20" });
  assert.deepEqual(surgery, { history: [{ phase: "cirugia", date: "2026-11-20" }], phase: "cirugia", placedOn: "2026-11-20" });
  const jump = mark(surgery.history, surgery, { phase: "rehabilitacion", was: null, date: today });
  assert.equal(jump.phase, "rehabilitacion");
  const back = mark(jump.history, jump, { phase: "plan", was: null, date: "2026-11-01" });
  assert.equal(back.phase, "rehabilitacion", "completar una etapa anterior no cambia la actual");
  assert.deepEqual(back.history.map(entry => entry.phase), ["plan", "cirugia", "rehabilitacion"], "en el orden de las etapas");
  assert.equal(back.placedOn, "2026-11-20");
});

test("etapas: la fecha de la cirugía es la de instalación; sin fecha queda marcada sin día", () => {
  const history = [{ phase: "cirugia", date: "2026-11-20" }];
  const moved = mark(history, staged("cirugia", "2026-11-20"), { phase: "cirugia", was: "2026-11-20", date: "2026-11-18" });
  assert.deepEqual([moved.history[0].date, moved.placedOn], ["2026-11-18", "2026-11-18"]);
  const blank = mark(history, staged("cirugia", "2026-11-20"), { phase: "cirugia", was: "2026-11-20", date: "" });
  assert.deepEqual(blank, { history: [{ phase: "cirugia", date: "" }], phase: "cirugia", placedOn: "" });
  const other = mark([], staged("", "2026-11-20"), { phase: "plan", was: null, date: "" });
  assert.deepEqual([other.history, other.placedOn], [[{ phase: "plan", date: "" }], "2026-11-20"], "marcar otra etapa no toca la instalación");
});

test("etapas: un implante anterior conserva su etapa y muestra la instalación en la cirugía", () => {
  assert.deepEqual(stageMarks([], "cirugia", "2026-11-24"), { cirugia: "2026-11-24" });
  assert.deepEqual(stageMarks([], "osteointegracion", "2026-11-24"), { osteointegracion: "" }, "no se da por marcada la cirugía");
  const next = mark([], staged("osteointegracion"), { phase: "rehabilitacion", was: null, date: today });
  assert.deepEqual(next.history, [{ phase: "osteointegracion", date: "" }, { phase: "rehabilitacion", date: today }]);
  const dated = mark([], staged("cirugia", "2026-11-24"), { phase: "osteointegracion", was: null, date: today });
  assert.deepEqual(dated.history, [{ phase: "cirugia", date: "2026-11-24" }, { phase: "osteointegracion", date: today }]);
});

test("etapas: quitar la marca actual vuelve a la anterior; quitar la cirugía quita la instalación", () => {
  const history = [{ phase: "cirugia", date: "2026-08-01" }, { phase: "osteointegracion", date: today }];
  const current = staged("osteointegracion", "2026-08-01");
  assert.deepEqual(mark(history, current, { phase: "osteointegracion", was: today, remove: true }), { history: [history[0]], phase: "cirugia", placedOn: "2026-08-01" });
  assert.deepEqual(mark(history, current, { phase: "cirugia", was: "2026-08-01", remove: true }), { history: [history[1]], phase: "osteointegracion", placedOn: "" });
  assert.deepEqual(mark([history[0]], staged("cirugia", "2026-08-01"), { phase: "cirugia", was: "2026-08-01", remove: true }), { history: [], phase: "", placedOn: "" });
  const twice = [{ phase: "plan", date: "2026-07-01" }, { phase: "cirugia", date: "" }, { phase: "plan", date: "2026-07-05" }];
  assert.deepEqual(mark(twice, staged("plan"), { phase: "plan", was: "2026-07-05", remove: true }).history, [{ phase: "cirugia", date: "" }], "las repetidas se van juntas");
});

test("etapas: no se pisa lo que cambió en otro lado ni se aceptan fechas futuras", () => {
  const history = [{ phase: "cirugia", date: "2026-11-20" }];
  const current = staged("cirugia", "2026-11-20");
  for (const change of [{ phase: "cirugia", was: null, date: today }, { phase: "cirugia", was: "2026-11-01", date: today }, { phase: "plan", was: "", date: today }, { phase: "plan", was: null, remove: true }, { phase: "plan", date: today }])
    assert.ok(mark(history, current, change).error, JSON.stringify(change));
  assert.equal(mark(history, current, { phase: "cirugia", was: null, date: today }).stale, true);
  for (const date of ["2026-12-01", "19/11", undefined]) assert.ok(mark(history, current, { phase: "plan", was: null, date }).error);
  for (const change of [null, { phase: "x", was: null, date: "" }, { phase: "", was: null, date: "" }]) assert.ok(mark(history, current, change).error);
});

test("conexión e historial salen en el respaldo y en la ficha descargada", () => {
  const row = { id: 7, tooth: "1.1", phase: "osteointegracion", brand: "Marca A", system: "", connection: "conica", history: '[{"phase":"cirugia","date":""},{"phase":"osteointegracion","date":"2026-11-25"}]',
    diameter: 3.3, length: 9, placedOn: "", torque: null, isq: null, productId: null, note: "", images: "[]", createdByName: "Dr. Prueba", createdAt: today, updatedAt: today };
  const saved = backupImplant(row);
  assert.equal(saved.connection, "conica");
  assert.deepEqual(saved.history, [{ phase: "cirugia", date: "" }, { phase: "osteointegracion", date: "2026-11-25" }]);
  const markdown = fichaMarkdown({ patient: { id: 1, name: "Paciente Ficticio" }, evolutions: [], budgets: [], appointments: [], periodontalExams: [], odontogram: null, imageMetadata: [], implants: [saved] });
  assert.match(markdown, /3,3 × 9 mm · Conexión cónica · etapas: Cirugía sin fecha, Osteointegración 25-11-2026/);
});

test("API: una etapa solo se cambia desde lo que se veía, nada se pisa y la conexión no se borra desde una pantalla antigua", () => {
  const route = read("app/api/implantes/route.ts");
  assert.match(route, /setStage\(parseHistory\(current\.history\), current, body\.markStage, santiagoToday\(\)\)/);
  assert.match(route, /placedOn: edited\.placedOn/);
  assert.match(route, /mergeImplantEdit\(current, body\)/);
  assert.match(route, /eq\(implants\.history, current\.history\), eq\(implants\.phase, current\.phase\), eq\(implants\.updatedAt, current\.updatedAt\)/);
  const panel = read("components/implantology.tsx");
  assert.equal(panel.match(/send<\{ implant: Implant \}>\("PATCH", \{ \.\.\.toDraft\(\w+\), id: \w+\.id, base: toDraft\(\w+\),/g).length, 2);
  assert.match(panel, /base: JSON\.parse\(baseline\)/);
  assert.match(panel, /event\.stopPropagation\(\); setOpen\(null\)/, "Escape cierra solo la imagen");
  // Las conexiones propuestas salen solo de la cuenta propia y sin datos de pacientes.
  assert.match(route, /select\(\{ brand: implants\.brand, system: implants\.system, connection: implants\.connection \}\)\.from\(implants\)\.where\(and\(eq\(implants\.ownerId, ownerId\)/);
});

test("ficha abierta desde antes: lo que no se tocó no pisa lo guardado y un choque en etapa o conexión se avisa", () => {
  const current = { tooth: "3.6", phase: "osteointegracion", brand: "Marca A", system: "", connection: "conica", diameter: 4.1, length: 10, placedOn: "", torque: null, isq: null, productId: 5, note: "" };
  const base = { tooth: "3.6", phase: "cirugia", brand: "Marca A", system: "", connection: "", diameter: "4,1", length: "10", placedOn: "", torque: "", isq: "", productId: "5", note: "" };
  const merged = mergeImplantEdit(current, { ...base, note: "control", base });
  const saved = cleanImplantFields(merged.input, today).fields;
  assert.deepEqual([saved.phase, saved.connection, saved.note, saved.diameter, saved.productId], ["osteointegracion", "conica", "control", 4.1, 5]);
  assert.match(mergeImplantEdit(current, { ...base, phase: "plan", base }).error, /etapa/);
  assert.match(mergeImplantEdit(current, { ...base, connection: "otra", base }).error, /conexión/);
  assert.equal(mergeImplantEdit(current, { ...base, phase: "osteointegracion", base }).input.phase, "osteointegracion", "ambos marcaron lo mismo");
  assert.equal(mergeImplantEdit({ ...current, phase: "cirugia" }, { ...base, phase: "osteointegracion", base }).input.phase, "osteointegracion", "cambio propio sin choque");
  const { connection, ...old } = base;
  assert.deepEqual([mergeImplantEdit(current, old).input.connection, mergeImplantEdit(current, old).input.phase], ["conica", "cirugia"], "pantalla antigua");
});

test("ventana: bajo el implantograma no queda nada; todo lo del implante está en su ventana", () => {
  const panel = read("components/implantology.tsx");
  const [below, inside] = panel.slice(panel.indexOf('data-testid="implantology"')).split("<ImplantSheet");
  assert.doesNotMatch(below, /BiomedicalProducts|CaptureLink|implant-form|implant-list|implant-capturer/);
  for (const part of [/<StageList/, /<BiomedicalProducts key=\{visit\} embedded compact/, /data-testid="implant-images"/, /<CaptureLink key=\{current\.id\}/, /data-testid="implant-delete"/]) assert.match(inside, part);
  assert.match(panel, /canClose=\{leave\}/);
  assert.match(panel, /if \(!next \|\| !leave\(\)\) return false;/, "pasar a otro implante también pregunta");
  assert.match(panel, /productTool\.current\?\.pending\(\)/);
  assert.match(read("components/biomedical-products.tsx"), /generation\.current !== started/, "una lectura tardía no reaparece");
  assert.match(read("components/implant-sheet.tsx"), /¿Desea eliminar la marca de/);
});
