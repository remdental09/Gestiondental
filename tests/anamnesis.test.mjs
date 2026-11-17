import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { anamnesisSummary, normalizeAnamnesis, emptyAnamnesis, mergeAnamnesis, anamnesisAlerts, hasAnamnesis } from "../lib/anamnesis.ts";
import { structureAnamnesis, notesSource, anamnesisFromNotes } from "../lib/dictation/openai-anamnesis.ts";

test("normaliza: descarta ids inválidos y recorta", () => {
  const a = normalizeAnamnesis({ conditions: ["diabetes", "diabetes", "inventada"], anticoagulants: "quizas", pregnancy: "x", allergies: "x".repeat(5000), bruxism: "si" });
  assert.deepEqual(a.conditions, ["diabetes"]);
  assert.equal(a.anticoagulants, "");
  assert.equal(a.pregnancy, "");
  assert.equal(a.allergies.length, 2000);
  assert.equal(a.bruxism, "si");
  assert.equal(hasAnamnesis(emptyAnamnesis()), false);
  assert.equal(hasAnamnesis(a), true);
});

test("lo dictado completa sin borrar lo registrado", () => {
  const cur = { ...emptyAnamnesis(), allergies: "Penicilina", conditions: ["asma"] };
  const out = mergeAnamnesis(cur, { ...emptyAnamnesis(), allergies: "Látex", conditions: ["diabetes"], anticoagulants: "si" });
  assert.equal(out.allergies, "Penicilina. Látex");
  assert.deepEqual(out.conditions, ["asma", "diabetes"]);
  assert.equal(out.anticoagulants, "si");
  assert.equal(mergeAnamnesis(cur, { ...emptyAnamnesis(), allergies: "penicilina" }).allergies, "Penicilina");
});

test("alertas: alergia real y anticoagulantes sí; 'niega alergias' no", () => {
  assert.deepEqual(anamnesisAlerts({ ...emptyAnamnesis(), allergies: "Niega alergias" }), []);
  const al = anamnesisAlerts({ ...emptyAnamnesis(), allergies: "Penicilina", anticoagulants: "si", conditions: ["diabetes"] });
  assert.equal(al.length, 3);
});

test("la IA se filtra por el esquema y no agrega campos", async () => {
  const fetcher = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ allergies: "Niega alergias", conditions: ["hipertension", "zzz"], medications: "Losartán", extra: "x" }) } }] }));
  const a = await structureAnamnesis("paciente hipertenso", "k", { fetcher });
  assert.deepEqual(a.conditions, ["hipertension"]);
  assert.equal(a.medications, "Losartán");
  assert.equal("extra" in a, false);
});

test("botón rojo en la ficha y API aislada por dueño", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const comp = readFileSync(new URL("../components/anamnesis-dialog.tsx", import.meta.url), "utf8");
  const api = readFileSync(new URL("../app/api/anamnesis/route.ts", import.meta.url), "utf8");
  assert.match(page, /<AnamnesisButton patientId=\{patient\.id\}/);
  assert.match(comp, /bg-\[#d62839\]/);
  assert.match(comp, /createAudioTranscription/);
  assert.match(api, /eq\(patients\.ownerId, ownerId\)/);
});

test("vista rápida: solo lo registrado y botón con tarjeta al pasar el mouse", () => {
  assert.deepEqual(anamnesisSummary(emptyAnamnesis()), []);
  const rows = anamnesisSummary({ ...emptyAnamnesis(), allergies: "Penicilina", conditions: ["asma"], otherConditions: "migraña", bruxism: "si" });
  assert.deepEqual(rows, [["Alergias", "Penicilina"], ["Enfermedades", "Asma / enfermedad respiratoria, migraña"], ["Bruxismo", "Sí"]]);
  const comp = readFileSync(new URL("../components/anamnesis-dialog.tsx", import.meta.url), "utf8");
  assert.match(comp, /<HoverCard /);
  assert.match(comp, /data-testid="anamnesis-hover"/);
});

test("en pantallas táctiles un toque despliega el resumen y ofrece editar", () => {
  const comp = readFileSync(new URL("../components/anamnesis-dialog.tsx", import.meta.url), "utf8");
  assert.match(comp, /\(hover: none\)/);
  assert.match(comp, /data-testid="anamnesis-reveal"/);
  assert.match(comp, /anam-funnel/);
  assert.match(comp, /prefers-reduced-motion/);
  assert.match(comp, /data-testid="anamnesis-edit"/);
});

test("armar desde evoluciones: orden cronológico, sin la línea de importación y con prompt de solo lo explícito", async () => {
  const notes = [
    { date: "2026-09-12", body: "Resina 19.\n\n— Importada desde la plataforma anterior · profesional: X · zona: Boca completa." },
    { date: "2026-08-21", body: "Paciente refiere alergia a penicilina." },
  ];
  const { text, used } = notesSource(notes);
  assert.equal(used, 2);
  assert.equal(text, "[21/08/2026] Paciente refiere alergia a penicilina.\n[12/09/2026] Resina 19.");
  let sent;
  const fetcher = async (_url, init) => { sent = JSON.parse(init.body); return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ allergies: "Penicilina (21/08/2026)" }) } }] })); };
  const r = await anamnesisFromNotes(notes, "k", { fetcher });
  assert.equal(r.anamnesis.allergies, "Penicilina (21/08/2026)");
  assert.deepEqual([r.used, r.total], [2, 2]);
  assert.match(sent.messages[0].content, /historial de evoluciones/);
  assert.match(sent.messages[0].content, /un tratamiento realizado NO es un antecedente/);
  assert.equal(sent.messages[1].content, text);
  await assert.rejects(() => anamnesisFromNotes([{ date: "2026-01-01", body: "  " }], "k", { fetcher }), /no tiene evoluciones/);
});

test("armar desde evoluciones: si no caben se omiten las del medio, no las primeras ni las últimas", () => {
  const notes = Array.from({ length: 10 }, (_, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, body: `nota ${i + 1} ` + "x".repeat(90) }));
  const { text, used } = notesSource(notes, 500);
  assert.ok(used < 10 && used >= 3);
  assert.match(text, /\[01\/01\/2026\]/);
  assert.match(text, /\[10\/01\/2026\]/);
  assert.doesNotMatch(text, /\[05\/01\/2026\]/);
});

test("la ruta propone y no guarda; el botón está en el formulario de la anamnesis", () => {
  const api = readFileSync(new URL("../app/api/anamnesis/route.ts", import.meta.url), "utf8");
  const comp = readFileSync(new URL("../components/anamnesis-dialog.tsx", import.meta.url), "utf8");
  assert.match(api, /fromEvolutions === true/);
  assert.match(api, /eq\(evolutions\.status, "vigente"\)/);
  assert.doesNotMatch(api.slice(api.indexOf("fromEvolutions")), /saveAnamnesis/);
  assert.match(comp, /anamnesis-from-notes/);
});

test("anamnesis en el celular: tarjetas y botones apilados, de ancho completo y fáciles de tocar; en pantallas grandes vuelve a la fila", () => {
  const dialog = readFileSync(new URL("../components/anamnesis-dialog.tsx", import.meta.url), "utf8");
  const card = dialog.slice(dialog.indexOf('data-testid="anamnesis-from-notes-card"') - 160, dialog.indexOf('data-testid="anamnesis-from-notes"'));
  assert.match(card, /flex flex-col gap-3/);
  assert.match(card, /sm:flex-row/);
  assert.ok(!/flex-wrap items-center justify-between gap-3 rounded-xl border border-\[#f0b7bd\]/.test(card), "el texto ya no queda en una columna angosta junto al botón");
  assert.match(dialog, /grid grid-cols-2 rounded-lg border border-\[#f0b7bd\] bg-white p-0\.5/, "selector Dictar / Escuchar entrevista en dos mitades");
  assert.match(dialog, /data-testid="anamnesis-dictate" className=\{`h-12 w-full/, "botón de dictar grande y de ancho completo");
  assert.match(dialog, /flex flex-col-reverse gap-2 sm:flex-row sm:justify-end/, "Guardar arriba y Cerrar abajo en el celular");
});
