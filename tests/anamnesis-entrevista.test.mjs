import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeInterview, localAnamnesisFromText } from "../lib/anamnesis-interview.ts";
import { structureInterview } from "../lib/dictation/openai-anamnesis.ts";

// Transcripciones de ejemplo SIN datos reales de pacientes (dos voces, sin marcas de hablante, como las entrega gpt-4o-transcribe).
const ENTREVISTA_1 = "¿Es alérgico a algún medicamento? Sí, soy alérgico al salbutamol, me da taquicardia. ¿Toma algún remedio de forma permanente? Sí, losartán 50 mg cada 12 horas. ¿Fuma? No, no fumo. ¿Tiene diabetes? No.";
const ENTREVISTA_2 = "¿Cómo ha estado de salud? Bien. ¿Alergias? No, ninguna. ¿Lo han operado? Me operaron de la vesícula hace 5 años. ¿Aprieta los dientes en la noche? Sí, mi pareja dice que rechino.";

const aiReply = obj => async (_url, init) => { aiReply.last = JSON.parse(init.body); return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(obj) } }] })); };

test("IA: alergia a salbutamol va en alergias, medicamento con dosis, negación ≠ no mencionado", async () => {
  const r = await structureInterview(ENTREVISTA_1, "k", { fetcher: aiReply({
    turns: [{ speaker: "dentista", text: "¿Es alérgico a algún medicamento?" }, { speaker: "paciente", text: "Sí, soy alérgico al salbutamol." }, { speaker: "otro", text: "x" }],
    anamnesis: { allergies: "Salbutamol (taquicardia)", medications: "Losartán 50 mg cada 12 h", smoking: "No fuma", conditions: [], alcohol: "", extra: "no" },
    doubtful: ["medications", "alcohol", "inventado"],
  }) });
  assert.equal(r.anamnesis.allergies, "Salbutamol (taquicardia)");
  assert.equal(r.anamnesis.medications, "Losartán 50 mg cada 12 h");
  assert.equal(r.anamnesis.smoking, "No fuma");           // negado expresamente
  assert.equal(r.anamnesis.alcohol, "");                   // no se conversó → vacío
  assert.deepEqual(r.anamnesis.conditions, []);            // diabetes negada no se agrega
  assert.deepEqual(r.doubtful, ["medications"]);           // dudoso vacío o clave inexistente se descarta
  assert.equal(r.turns.length, 2);                         // hablante inválido se descarta
  assert.equal("extra" in r.anamnesis, false);
  // Usa Luna 5.6 con salida JSON y un prompt que distingue «niega» de «no se habló».
  assert.equal(aiReply.last.model, "gpt-5.6-luna");
  assert.deepEqual(aiReply.last.response_format, { type: "json_object" });
  assert.match(aiReply.last.messages[0].content, /no se habló" ≠ "niega"/);
  assert.match(aiReply.last.messages[0].content, /PACIENTE/);
  assert.equal(aiReply.last.messages[1].content, ENTREVISTA_1);
});

test("normalizeInterview acepta la anamnesis plana y filtra condiciones inválidas", () => {
  const r = normalizeInterview({ allergies: "Niega alergias", conditions: ["hipertension", "zzz"] });
  assert.equal(r.anamnesis.allergies, "Niega alergias");
  assert.deepEqual(r.anamnesis.conditions, ["hipertension"]);
  assert.deepEqual(r.turns, []);
});

test("orden local (respaldo sin IA): salbutamol, losartán con dosis, niega tabaco, diabetes negada", () => {
  const r = localAnamnesisFromText(ENTREVISTA_1);
  assert.equal(r.fallback, true);
  assert.match(r.anamnesis.allergies, /^Salbutamol/);
  assert.doesNotMatch(r.anamnesis.medications, /salbutamol/i);
  assert.match(r.anamnesis.medications, /^Losartán 50 mg cada 12 horas/);
  assert.equal(r.anamnesis.smoking, "No fuma");
  assert.deepEqual(r.anamnesis.conditions, []);
  assert.equal(r.anamnesis.alcohol, "");                   // no mencionado → vacío
  assert.equal(r.anamnesis.surgeries, "");
  assert.ok(r.doubtful.includes("allergies") && r.doubtful.includes("medications"));
  assert.ok(!r.doubtful.includes("alcohol"));
});

test("orden local: niega alergias, cirugía, bruxismo; preguntas del dentista no cuentan", () => {
  const r = localAnamnesisFromText(ENTREVISTA_2);
  assert.equal(r.anamnesis.allergies, "Niega alergias");
  assert.match(r.anamnesis.surgeries, /vesícula/i);
  assert.equal(r.anamnesis.bruxism, "si");
  assert.equal(r.anamnesis.smoking, "");
  assert.equal(localAnamnesisFromText("¿Tiene hipertensión? ¿Toma aspirina?").anamnesis.conditions.length, 0);
  assert.deepEqual(localAnamnesisFromText("¿Tiene hipertensión? Sí. ¿Y diabetes? No.").anamnesis.conditions, ["hipertension"]);
  assert.equal(localAnamnesisFromText("¿Tiene hipertensión? ¿Toma aspirina?").anamnesis.anticoagulants, "");
});

test("la ruta cae al orden local si OpenAI falla y la UI exige consentimiento y 4 minutos", () => {
  const route = readFileSync(new URL("../app/api/anamnesis/route.ts", import.meta.url), "utf8");
  assert.match(route, /mode === "interview"/);
  assert.match(route, /catch \{ return json\(\{ \.\.\.localAnamnesisFromText\(transcript\)/);
  const ui = readFileSync(new URL("../components/anamnesis-dialog.tsx", import.meta.url), "utf8");
  assert.match(ui, /El paciente autorizó la grabación de la entrevista \(el audio no se guarda\)/);
  assert.match(ui, /Escuchar entrevista/);
  assert.match(ui, /MAX_DICTATION_MS/);
  const engine = readFileSync(new URL("../lib/dictation/audio-transcription.ts", import.meta.url), "utf8");
  assert.match(engine, /MAX_DICTATION_MS = 4 \* 60 \* 1000/);
  assert.doesNotMatch(route, /R2|IMAGES|put\(/);
});
