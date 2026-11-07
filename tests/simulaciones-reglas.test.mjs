import test from "node:test";
import assert from "node:assert/strict";
import { proposeFromTranscript } from "../lib/dictation/proposal.ts";

const run = async (transcript) => (await proposeFromTranscript({ transcript, chart: [] }, null, () => {}, { today: "2026-11-07" })).proposal;
const odo = (p) => p.odontogram.map((o) => `${o.tooth}:${o.kind === "surface" ? `${o.surface}/${o.finding?.condition}` : o.status}`);

test("extracción de una pieza más obturación en otra: la segunda no queda ausente", async () => {
  const p = await run("Se realiza extracción de la 2.4 mas implante inmediato, mas injerto, mas obturacion en la 1.6 oclusal por caries.");
  assert.ok(odo(p).includes("16:O/restored"));
  assert.ok(!odo(p).includes("16:Ausente"));
});

test("implante que finalmente no se instaló no queda como Implante", async () => {
  const p = await run("Extracción de la 2.4 con implante inmediato, pero finalmente no se instaló por falta de estabilidad primaria.");
  assert.ok(!odo(p).includes("24:Implante"));
});

test("obturación nominal «por caries» queda registrada como obturada", async () => {
  const p = await run("Obturación con resina compuesta en la pieza 1.6 oclusal por caries.");
  assert.deepEqual(odo(p), ["16:O/restored"]);
});

test("cambio de amalgama por resina con caries secundaria queda obturada", async () => {
  const p = await run("Cambio de amalgama por resina en la 1.5 oclusal, caries secundaria.");
  assert.deepEqual(odo(p), ["15:O/restored"]);
});

test("obturación de conductos, retrógrada o ferulización no son restauraciones", async () => {
  for (const text of ["Apicectomía en la 2.1 con obturación retrógrada con MTA.", "Luxación de la 1.1 por trauma, reposición y ferulización con alambre y resina por dos semanas.", "Pulpitis irreversible en la 2.6, se realiza endodoncia completa y obturación con gutapercha."]) {
    const p = await run(text);
    assert.ok(!(p.diagnosisPrompts ?? []).some((prompt) => prompt.procedure === "restauración"), text);
    assert.ok(!p.clarifications.some((q) => /Falta la superficie/.test(q)), text);
  }
});

test("alargamiento de corona clínica no deja la pieza como Corona; retracción con hilo no es recesión", async () => {
  assert.ok(!odo(await run("Alargamiento de corona clínica en la 2.1 por gingivectomía y osteoplastia.")).includes("21:Corona"));
  const p = await run("Preparación para corona de zirconio en la 2.6, retracción gingival con hilo, toma de impresión digital.");
  assert.ok(!p.diagnoses.some((dx) => dx.code === "DA0D.0"));
});

test("prestaciones de implante por reglas: instalación, extracción para implante inmediato; no en un plan", async () => {
  const done = await run("Se realiza exodoncia de la 4.7 y se instala implante en 4.7 de 4,3 por 11,5 con sutura nylon 4-0.");
  assert.deepEqual(done.prestaciones.map((x) => x.code).sort(), ["5011001", "5011018"]);
  const plan = await run("Plan: instalar implante en la 3.5 en tres meses, por ahora se extrae y se deja injerto.");
  assert.ok(!plan.prestaciones.some((x) => x.code === "5011001"));
});

test("endodoncia: el arancel sale del grupo dentario y de la vitalidad dictada; sin vitalidad no se adivina", async () => {
  const { endodonticCode } = await import("../lib/dictation/prestaciones.ts");
  assert.equal(endodonticCode(16, "pulpitis irreversible"), "5006015");
  assert.equal(endodonticCode(36, "necrosis pulpar"), "5006009");
  assert.equal(endodonticCode(24, "pulpitis"), "5006002");
  assert.equal(endodonticCode(11, "necrosis"), "5006007");
  assert.equal(endodonticCode(24, "tres conductos"), null);
  const p = await run("Se realiza endodoncia en la 1.6, pulpitis irreversible, cuatro conductos.");
  assert.deepEqual(p.prestaciones.map((x) => x.code), ["5006015"]);
});

test("cambio de amalgama por resina: la prestación es de resina", async () => {
  const p = await run("Cambio de amalgama por resina en la 2.5 oclusal, caries secundaria.");
  assert.deepEqual(p.prestaciones.map((x) => x.code), ["5005017"]);
});

test("extracción de incluido con osteotomía y sutura se da por realizada", async () => {
  const p = await run("Extracción de la 3.8 incluida, osteotomía y odontosección, sutura con seda 3-0, sin complicaciones.");
  assert.ok(odo(p).includes("38:Ausente"));
  assert.ok(!p.clarifications.some((q) => /ya se realiz/.test(q)));
});

test("preguntas de la IA duplicadas (marca) o ya resueltas por reglas (prestación) no se repiten", async () => {
  const T = "Se instala implante en la 3.5, hueso tipo 3, torque 35 newton, marca Arsis, sin carga.";
  const nota = { motivo: "", anamnesis: "", alergias: "", medicamentos: "", examen: "", diagnostico: "", procedimientos: "Se instala un implante en la pieza 3.5.", plan: "", indicaciones: "", presupuesto: "" };
  const out = { nota, hallazgos: [], procedimientos: [], presupuesto: [], ficha: [], texto_corregido: T, periodonto: [], pagos: [], citas: [], diagnosticos: [], diagnosticos_sugeridos: [],
    dudas: ["¿La marca dictada como «Arsis» corresponde a Arcsys u otra marca?", "No hay una prestación candidata que corresponda con certeza a la instalación de un implante realizada hoy; ¿qué código arancelario corresponde?"] };
  const model = { id: "x", model: "x", complete: async () => ({ usedModel: "x", output: out }) };
  const p = (await proposeFromTranscript({ transcript: T, chart: [] }, model, () => {}, { today: "2026-11-07" })).proposal;
  assert.equal(p.clarifications.filter((q) => /^(?:IA: )?¿La marca/.test(q)).length, 1);
  assert.ok(!p.clarifications.some((q) => /No hay una prestaci/.test(q)));
});

test("cementación o preparación de corona en pieza natural se titula Prótesis, no Evaluación", async () => {
  const { classifyEvolution } = await import("../lib/dictation/evolution-type.ts");
  assert.equal(classifyEvolution("Se realiza cementación de corona metal cerámica en la pieza 3.4 con cemento de ionómero.", "FDI 3.4").type, "protesis");
  assert.equal(classifyEvolution("Se realiza preparación de la pieza 1.1 para corona de zirconio y toma de impresión digital.", "FDI 1.1").type, "protesis");
});

test("raspado y alisado radicular sugiere el pulido radicular por sextante del arancel", async () => {
  const p = await run("Se realiza raspado y alisado radicular en el cuadrante 1 y 2, anestesia local.");
  assert.ok(p.prestaciones.some((x) => x.code === "5009003"));
  const deep = await run("Se realiza raspado y alisado radicular en bolsas profundas del cuadrante 3.");
  assert.ok(deep.prestaciones.some((x) => x.code === "5009012"));
});

test("retratamiento de conducto sugiere la desobturación del arancel", async () => {
  const p = await run("Retratamiento endodóntico de la 4.7, se retira gutapercha y se medica con hidróxido de calcio.");
  assert.ok(p.prestaciones.some((x) => x.code === "5006005"));
});

test("el artículo «un» de la nota redactada no se toma como la cifra 1 (falso aviso «menciona 1»)", async () => {
  const T = "Segunda fase del implante de la 2.1, se instala pilar de cicatrización de 4 milímetros.";
  const nota = { motivo: "", anamnesis: "", alergias: "", medicamentos: "", examen: "", diagnostico: "", procedimientos: "Se realiza la segunda fase del implante en la pieza 2.1 y se instala un pilar de cicatrización de 4 mm.", plan: "", indicaciones: "", presupuesto: "" };
  const out = { nota, hallazgos: [], procedimientos: [], presupuesto: [], ficha: [], texto_corregido: T, periodonto: [], pagos: [], citas: [], diagnosticos: [], diagnosticos_sugeridos: [], dudas: [] };
  const model = { id: "x", model: "x", complete: async () => ({ usedModel: "x", output: out }) };
  const p = (await proposeFromTranscript({ transcript: T, chart: [] }, model, () => {}, { today: "2026-11-07" })).proposal;
  assert.ok(!p.clarifications.some((q) => /menciona «1»/.test(q)));
});

test("restauración con causa no cariosa («por abrasión cervical») conserva la cara dictada", async () => {
  const p = await run("Restauración con resina de la 2.7 vestibular por abrasión cervical.");
  assert.deepEqual(odo(p), ["27:V/restored"]);
  assert.ok(!p.clarifications.some((q) => /Falta la superficie/.test(q)));
});

test("carilla de porcelana propuesta por la IA como superficie no pregunta la cara", async () => {
  const T = "Carilla de porcelana en la 1.1, color A1, cementación adhesiva.";
  const nota = { motivo: "", anamnesis: "", alergias: "", medicamentos: "", examen: "", diagnostico: "", procedimientos: "Cementación adhesiva de carilla de porcelana en la pieza 1.1, color A1.", plan: "", indicaciones: "", presupuesto: "" };
  const out = { nota, hallazgos: [{ pieza: "1.1", tipo: "superficie", superficie: "", condicion: "otra_restauracion", estado: "", evidencia: "Carilla de porcelana en la 1.1" }], procedimientos: [], presupuesto: [], ficha: [], texto_corregido: T, periodonto: [], pagos: [], citas: [], diagnosticos: [], diagnosticos_sugeridos: [], dudas: [] };
  const model = { id: "x", model: "x", complete: async () => ({ usedModel: "x", output: out }) };
  const p = (await proposeFromTranscript({ transcript: T, chart: [] }, model, () => {}, { today: "2026-11-07" })).proposal;
  assert.ok(!p.clarifications.some((q) => /Falta la cara/.test(q)));
});
