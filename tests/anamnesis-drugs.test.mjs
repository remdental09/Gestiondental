import test from "node:test";
import assert from "node:assert/strict";
import { extractMedications, addMissingMedications } from "../lib/anamnesis-drugs.ts";
import { localAnamnesisFromText } from "../lib/anamnesis-interview.ts";
import { emptyAnamnesis } from "../lib/anamnesis.ts";

// Entrevista ficticia, sin datos de pacientes reales.
const ENTREVISTA = "Cuéntame, ¿tiene artritis reumatoidea? ¿Y ahí qué estás tomando para eso? Metotrexato. ¿La dosis de metotrexato? Son seis dosis una vez por semana con metotrexato por la artritis reumatoidea. ¿Algún otro medicamento? Sertralina para la ansiedad y fentermina para bajar de pesos. Ese sería la anamnesis.";

test("los fármacos nombrados por el paciente quedan con dosis e indicación", () => {
  const meds = extractMedications(ENTREVISTA);
  assert.equal(meds.length, 3);
  assert.equal(meds[0], "Metotrexato seis dosis una vez por semana (artritis reumatoidea)");
  assert.equal(meds[1], "Sertralina (ansiedad)");
  assert.match(meds[2], /^Fentermina/);
});

test("preguntas, negaciones y alergias no agregan fármacos", () => {
  assert.deepEqual(extractMedications("¿Toma losartán? No tomo losartán. Soy alérgico a la amoxicilina."), []);
  assert.deepEqual(extractMedications("Ya no tomo metformina."), []);
});

test("la dosis dicha en otra frase se atribuye al fármaco de la pregunta", () => {
  assert.deepEqual(extractMedications("¿La dosis de metotrexato? Seis dosis una vez por semana."), ["Metotrexato seis dosis una vez por semana"]);
});

test("dosis en mg y frecuencia se conservan tal como se dijeron", () => {
  assert.deepEqual(extractMedications("Tomo losartán 50 mg cada 12 horas para la presión."), ["Losartán 50 mg cada 12 horas (presión)"]);
});

test("si la IA omitió fármacos, se agregan sin duplicar los que ya estaban", () => {
  const ia = { ...emptyAnamnesis(), medications: "Metotrexato 15 mg semanal" };
  const { anamnesis, added } = addMissingMedications(ia, ENTREVISTA);
  assert.equal(added.length, 2);
  assert.match(anamnesis.medications, /^Metotrexato 15 mg semanal\. Sertralina \(ansiedad\)\. Fentermina/);
  assert.equal(addMissingMedications(anamnesis, ENTREVISTA).added.length, 0, "no se repite al volver a ejecutar");
});

test("el orden local sin IA también llena Medicamentos y las enfermedades", () => {
  const { anamnesis } = localAnamnesisFromText(ENTREVISTA);
  assert.match(anamnesis.medications, /Metotrexato.*Sertralina.*Fentermina/);
  assert.ok(anamnesis.conditions.includes("autoinmune"));
});
