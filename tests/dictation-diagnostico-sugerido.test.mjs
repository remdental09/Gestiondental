import test from "node:test";
import assert from "node:assert/strict";
import { proposeFromTranscript } from "../lib/dictation/proposal.ts";

const TEXT = "Cirugía de implante en la pieza 8. Se realiza la extracción de una raíz dental de la pieza 8 y se instala un implante de 3,3 por 8 milímetros de marca FGM Arcsys en el alvéolo fresco.";
const nota = { motivo: "Cirugía de implante en la pieza 8.", anamnesis: "", alergias: "", medicamentos: "", examen: "", diagnostico: "", procedimientos: "Extracción de raíz dental en la pieza 8. Instalación de implante.", plan: "", indicaciones: "", presupuesto: "" };
const base = { nota, hallazgos: [], procedimientos: [], presupuesto: [], ficha: [], texto_corregido: TEXT, periodonto: [], pagos: [], citas: [], diagnosticos: [], dudas: [] };
const model = (extra) => ({ id: "x", model: "x", complete: async () => ({ usedModel: "x", output: { ...base, ...extra } }) });
const run = async (extra, transcript = TEXT) => (await proposeFromTranscript({ transcript, chart: [] }, model(extra), () => {}, { today: "2026-11-07" })).proposal;

test("sin diagnóstico dictado: sugiere el más cercano del catálogo, con la frase como respaldo", async () => {
  const proposal = await run({ diagnosticos_sugeridos: [{ termino: "raíz dental retenida", pieza: "8", evidencia: "Se realiza la extracción de una raíz dental de la pieza 8" }] });
  const dx = (proposal.diagnoses ?? []).filter((item) => item.suggested?.from === "nota");
  assert.equal(dx.length, 1);
  assert.equal(dx[0].code, "DA0A.3");
  assert.match(dx[0].suggested.term, /extracción de una raíz dental/);
  assert.match(dx[0].evidence, /raíz dental/);
});

// Estas pruebas validan lo que propone el modelo (origin «ia»); el código deduce aparte sus propias sugerencias (origin «reglas»).
const fromModel = (proposal) => (proposal.diagnoses ?? []).filter((item) => item.suggested?.from === "nota" && item.origin === "ia");

test("un término fuera del catálogo no genera sugerencia ni código inventado", async () => {
  const proposal = await run({ diagnosticos_sugeridos: [{ termino: "zzz inexistente qqq", pieza: "8", evidencia: "Se realiza la extracción de una raíz dental de la pieza 8" }] });
  assert.equal(fromModel(proposal).length, 0);
});

test("evidencia que no está en el dictado se descarta", async () => {
  const proposal = await run({ diagnosticos_sugeridos: [{ termino: "raíz dental retenida", pieza: "8", evidencia: "Fractura radicular vertical con absceso" }] });
  assert.equal(fromModel(proposal).length, 0);
});

test("si el profesional ya dictó diagnóstico para la pieza, no se sugiere otro", async () => {
  const transcript = `${TEXT} Diagnóstico pulpitis irreversible sintomática de la pieza 8.`;
  const proposal = await run({
    diagnosticos: [{ termino: "pulpitis irreversible sintomática", pieza: "8", evidencia: "Diagnóstico pulpitis irreversible sintomática de la pieza 8" }],
    diagnosticos_sugeridos: [{ termino: "raíz dental retenida", pieza: "8", evidencia: "Se realiza la extracción de una raíz dental de la pieza 8" }],
  }, transcript);
  assert.equal((proposal.diagnoses ?? []).filter((item) => item.suggested?.from === "nota").length, 0);
  assert.ok((proposal.diagnoses ?? []).some((item) => item.code.startsWith("DA09")));
});

test("el modelo puede omitir el campo (modelos chicos) sin romper la propuesta", async () => {
  const proposal = await run({});
  assert.ok(Array.isArray(proposal.diagnoses ?? []));
});
