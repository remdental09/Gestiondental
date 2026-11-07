import test from "node:test";
import assert from "node:assert/strict";
import { SPECIALTIES, detectSpecialties, searchKnowledge, buildSpecialtyContext, specialtyPromptBlock, SPECIALTY_PROMPT_BUDGET, knowledgeStats } from "../lib/knowledge/index.ts";
import { foldText } from "../lib/knowledge/specialty.ts";
import { buildModelUserPrompt } from "../lib/dictation/proposal.ts";
import { runAgentTool, AGENT_TOOLS } from "../lib/dictation/agent-tools.ts";

const ids = (text) => detectSpecialties(text).map((hit) => hit.id);

test("cada especialidad está en su archivo, sin ids repetidos y con contenido", () => {
  assert.equal(new Set(SPECIALTIES.map((item) => item.id)).size, SPECIALTIES.length);
  for (const stat of knowledgeStats()) assert.ok(stat.terminos >= 50, `${stat.nombre} tiene ${stat.terminos} términos`);
});

test("ninguna variante mal oída es igual al término correcto", () => {
  for (const specialty of SPECIALTIES) {
    for (const entry of specialty.entradas) {
      for (const form of entry.oidoMal ?? []) assert.notEqual(foldText(form), foldText(entry.termino), `${specialty.id}: ${entry.termino}`);
    }
  }
});

test("detecta la especialidad del dictado y solo esas", () => {
  assert.deepEqual(ids("Cirugía de implante en la pieza 8, se instala implante en el alvéolo fresco con carga inmediata").slice(0, 1), ["implantologia"]);
  assert.ok(ids("Se realiza trepanación, conductometría con localizador apical y medicación intraconducto con hidróxido de calcio").includes("endodoncia"));
  assert.ok(ids("Destartraje supra y subgingival, sondaje con bolsas de 5 mm y sangrado al sondaje").includes("periodoncia"));
  assert.ok(ids("Control de ortodoncia, cambio de arco NiTi y elásticos clase II").includes("ortodoncia"));
  assert.ok(ids("Cementación de corona de disilicato de litio con RelyX").includes("rehabilitacion"));
  assert.deepEqual(ids("Paciente viene a control, sin novedades."), []);
});

test("«diente temporal» no se confunde con el músculo temporal (ATM)", () => {
  assert.ok(!ids("pulpotomía en diente temporal 8.5").includes("ttm"));
  assert.ok(ids("pulpotomía en diente temporal 8.5").includes("odontopediatria"));
});

test("la búsqueda corrige lo que la voz deforma, en cualquier especialidad", () => {
  const top = (q) => searchKnowledge(q, { limit: 1 })[0]?.termino;
  assert.equal(top("vicril"), "Vicryl");
  assert.equal(top("bio os"), "Bio-Oss");
  assert.equal(top("pro taper"), "ProTaper");
  assert.equal(top("velo fresco"), "alvéolo fresco");
  assert.equal(top("gracie"), "Gracey");
  assert.equal(top("emax"), "IPS e.max");
  assert.equal(top("Arsis"), "Arcsys");
  assert.equal(top("alvojil"), "Alvogyl");
  assert.equal(searchKnowledge("zzzz qqqq").length, 0);
});

test("el bloque de una especialidad respeta su presupuesto y empieza por notas y variantes oídas", () => {
  for (const specialty of SPECIALTIES) {
    const block = specialtyPromptBlock(specialty);
    assert.ok(block.length <= SPECIALTY_PROMPT_BUDGET + 200, `${specialty.id}: ${block.length}`);
    assert.match(block, new RegExp(`^Especialidad: ${specialty.nombre}`));
  }
  const implant = specialtyPromptBlock(SPECIALTIES.find((item) => item.id === "implantologia"));
  assert.match(implant, /velo fresco/);
  assert.doesNotMatch(implant, /Straumann/, "los sistemas de implantes ya van en el prompt base: solo por búsqueda");
});

test("el prompt del modelo trae solo las especialidades detectadas", () => {
  const prompt = buildModelUserPrompt({ transcript: "Se instala un implante en el alvéolo fresco de la pieza 8 con injerto de Bio-Oss.", chart: [] });
  assert.match(prompt, /VOCABULARIO DE ESPECIALIDAD/);
  assert.match(prompt, /Especialidad: Implantología/);
  assert.doesNotMatch(prompt, /Especialidad: Ortodoncia/);
  assert.equal(buildSpecialtyContext("Paciente viene a control, sin novedades."), "");
});

test("herramienta del agente: busca en toda la base y es de solo lectura", () => {
  assert.ok(AGENT_TOOLS.some((tool) => tool.function.name === "buscar_termino_odontologico"));
  const result = JSON.parse(runAgentTool("buscar_termino_odontologico", JSON.stringify({ consulta: "vicril 4-0" })));
  assert.equal(result.resultados[0].termino, "Vicryl");
  assert.equal(result.resultados[0].empresa, "Ethicon");
});
