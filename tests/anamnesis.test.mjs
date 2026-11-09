import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeAnamnesis, emptyAnamnesis, mergeAnamnesis, anamnesisAlerts, hasAnamnesis } from "../lib/anamnesis.ts";
import { structureAnamnesis } from "../lib/dictation/openai-anamnesis.ts";

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
