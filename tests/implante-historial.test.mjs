import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MAX_PHASE_HISTORY, backupImplant, cleanImplantFields, connectionText, editHistory, mergeImplantEdit, nextPhase, parseHistory, recordPhase, suggestConnection } from "../lib/implants.ts";
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

test("etapas: la siguiente se ofrece en orden; sin etapa o en la última no hay avance", () => {
  assert.equal(nextPhase("cirugia"), "osteointegracion");
  assert.equal(nextPhase("rehabilitacion"), "mantencion");
  assert.equal(nextPhase("mantencion"), null);
  assert.equal(nextPhase(""), null);
});

test("historial: la ficha no inventa fechas; «Pasar a…» anota hoy y la cirugía usa la fecha de instalación", () => {
  assert.deepEqual(recordPhase([], none, at("plan")), [{ phase: "plan", date: "" }]);
  assert.deepEqual(recordPhase([], none, at("mantencion", "2020-03-01")), [{ phase: "mantencion", date: "" }]);
  assert.deepEqual(recordPhase([], none, at("cirugia", "2026-11-20")), [{ phase: "cirugia", date: "2026-11-20" }]);
  assert.deepEqual(recordPhase([], none, at("cirugia")), [{ phase: "cirugia", date: "" }]);
  assert.deepEqual(recordPhase([], none, at("plan"), today), [{ phase: "plan", date: today }]);
  assert.deepEqual(recordPhase([], none, at("cirugia"), today), [{ phase: "cirugia", date: today }]);
  assert.deepEqual(recordPhase([], none, none, today), []);
  const history = [{ phase: "plan", date: "2026-11-01" }];
  assert.deepEqual(recordPhase(history, at("plan"), at("plan"), today), history, "guardar sin cambiar de etapa no agrega nada");
  assert.deepEqual(recordPhase(history, at("plan"), none, today), history, "dejar sin etapa conserva lo anotado");
  assert.deepEqual(recordPhase(history, none, at("plan"), today), history, "volver a marcar la misma no la repite");
});

test("historial: un implante anterior conserva su etapa sin inventarle fecha", () => {
  assert.deepEqual(recordPhase([], at("osteointegracion"), at("rehabilitacion"), today), [{ phase: "osteointegracion", date: "" }, { phase: "rehabilitacion", date: today }]);
  assert.deepEqual(recordPhase([], at("cirugia", "2026-08-01"), at("osteointegracion", "2026-08-01"), today), [{ phase: "cirugia", date: "2026-08-01" }, { phase: "osteointegracion", date: today }]);
});

test("historial: la cirugía sigue a la fecha de instalación corregida, pero no pisa una fecha escrita a mano", () => {
  const history = [{ phase: "cirugia", date: "2026-11-20" }, { phase: "osteointegracion", date: today }];
  const moved = recordPhase(history, at("osteointegracion", "2026-11-20"), at("osteointegracion", "2026-11-18"), today);
  assert.deepEqual(moved, [{ phase: "cirugia", date: "2026-11-18" }, { phase: "osteointegracion", date: today }]);
  const own = [{ phase: "cirugia", date: "2026-11-02" }];
  assert.deepEqual(recordPhase(own, at("cirugia", "2026-11-20"), at("cirugia", "2026-11-18"), today), own);
});

test("historial: tiene tope y omite lo dañado", () => {
  let history = [];
  for (let i = 0; i < MAX_PHASE_HISTORY + 5; i++) history = recordPhase(history, at(i % 2 ? "plan" : "evaluacion"), at(i % 2 ? "evaluacion" : "plan"), today);
  assert.equal(history.length, MAX_PHASE_HISTORY);
  assert.deepEqual(parseHistory('[{"phase":"plan","date":""},{"phase":"x","date":""},{"phase":"plan","date":"ayer"},null]'), [{ phase: "plan", date: "" }]);
  for (const raw of ["no es json", "{}", undefined]) assert.deepEqual(parseHistory(raw), []);
});

test("historial: corregir una fecha exige que la entrada siga igual y no admite futuro", () => {
  const history = [{ phase: "cirugia", date: "2026-11-20" }];
  const change = { index: 0, phase: "cirugia", date: "2026-11-20" };
  assert.deepEqual(editHistory(history, "cirugia", { ...change, to: "2026-11-19" }, today), { history: [{ phase: "cirugia", date: "2026-11-19" }], phase: "cirugia" });
  assert.deepEqual(editHistory(history, "cirugia", { ...change, to: "" }, today).history, [{ phase: "cirugia", date: "" }]);
  assert.ok(editHistory(history, "cirugia", { ...change, to: "2026-12-01" }, today).error);
  assert.ok(editHistory(history, "cirugia", { ...change, to: "19/11" }, today).error);
  for (const stale of [{ ...change, index: 1 }, { ...change, index: "0" }, { ...change, date: "2026-11-01" }, { ...change, phase: "plan" }, null]) assert.equal(editHistory(history, "cirugia", stale, today).stale, true);
});

test("historial: eliminar la etapa actual vuelve a la anterior; eliminar otra no cambia la etapa", () => {
  const history = [{ phase: "cirugia", date: "2026-08-01" }, { phase: "osteointegracion", date: today }];
  const last = { index: 1, phase: "osteointegracion", date: today, remove: true };
  assert.deepEqual(editHistory(history, "osteointegracion", last, today), { history: [history[0]], phase: "cirugia" });
  assert.deepEqual(editHistory(history, "osteointegracion", { index: 0, phase: "cirugia", date: "2026-08-01", remove: true }, today), { history: [history[1]], phase: "osteointegracion" });
  assert.deepEqual(editHistory([history[0]], "cirugia", { index: 0, phase: "cirugia", date: "2026-08-01", remove: true }, today), { history: [], phase: "" });
  assert.equal(editHistory(history, "", last, today).phase, "", "sin etapa registrada, sigue sin ella");
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

test("API: la etapa solo avanza desde la que se veía, nada se pisa y la conexión no se borra desde una pantalla antigua", () => {
  const route = read("app/api/implantes/route.ts");
  assert.match(route, /body\.advanceFrom !== current\.phase/);
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

test("capturadora: mientras la ventana muestra otro implante, la ficha abierta deja de recibir", () => {
  const panel = read("components/implantology.tsx");
  assert.match(panel, /lookingElsewhere = Boolean\(sheetItem && draft\?\.id && sheetItem\.id !== draft\.id\)/);
  assert.match(panel, /paused=\{lookingElsewhere\}/);
  const link = read("components/capture-link.tsx");
  assert.match(link, /if \(paused\) \{ setState\(\{ kind: "idle" \}\); return; \}/);
  assert.match(link, /\}, \[restored, paused\]\);/);
});
