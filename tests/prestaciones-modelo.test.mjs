import test from "node:test";
import assert from "node:assert/strict";
import { suggestPrestaciones } from "../lib/dictation/prestaciones.ts";
import { candidatePrestaciones, prestacionByCode } from "../lib/prestaciones-catalog.ts";
import { buildModelUserPrompt, AI_JSON_SCHEMA } from "../lib/dictation/proposal.ts";

const codes = (items) => items.map((item) => item.code);

test("acepta el código elegido por el modelo si existe en el catálogo y toma la pieza del texto", () => {
  const out = suggestPrestaciones([], [], [{ text: "Se instala corona metal cerámica en 1.5", evidence: "corona metal cerámica en 1.5", code: "5103051" }]);
  assert.deepEqual(codes(out), ["5103051"]);
  assert.equal(out[0].tooth, 15);
});

test("descarta un código inventado", () => {
  assert.equal(prestacionByCode("9999999"), undefined);
  assert.deepEqual(suggestPrestaciones([], [], [{ text: "Se instala corona en 1.5", code: "9999999" }]), []);
});

test("sellantes en plural se reconocen por regla", () => {
  assert.deepEqual(codes(suggestPrestaciones([], ["Se aplican sellantes en 1.6 y 2.6"])), ["5005012"]);
});

test("sin regla ni código, la búsqueda por palabras solo asigna si es clara", () => {
  assert.deepEqual(codes(suggestPrestaciones([], ["Exodoncia simple de 4.8"])), ["5003001"]);
  assert.deepEqual(suggestPrestaciones([], ["Se conversa con el paciente sobre su dieta"]), []);
});

test("los candidatos incluyen endodoncia, sellante e implante y el mensaje al modelo los lista", () => {
  const near = (text, code) => assert.ok(candidatePrestaciones(text, 40).some((item) => item.code === code), `${text} → ${code}`);
  near("Tratamiento de conductos en molar inferior vital", "5006003");
  near("Sellantes en 1.6", "5005012");
  near("Se instala implante en 4.1", "5011001");
  const prompt = buildModelUserPrompt({ transcript: "Se instala corona metal cerámica en 1.5", chart: [] });
  assert.match(prompt, /Prestaciones candidatas del arancel/);
  assert.match(prompt, /5103051 · /);
});

test("el esquema exige «codigo» en cada procedimiento", () => {
  assert.ok(AI_JSON_SCHEMA.properties.procedimientos.items.required.includes("codigo"));
});
