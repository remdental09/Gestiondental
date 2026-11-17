import test from "node:test";
import assert from "node:assert/strict";
import { proposeFromTranscript, AI_JSON_SCHEMA, buildModelUserPrompt, validateModelOutput } from "../lib/dictation/proposal.ts";
import { ageFrom, expandRange, fdiToChile, inferSexFromName, kindOf, parseAiItems, polishNote } from "../lib/dictation/clinical-items.ts";

const run = async (transcript, extra = {}) => (await proposeFromTranscript({ transcript, chart: [], ...extra }, null, () => {}, { today: "2026-11-16" })).proposal;
const items = (p) => (p.items ?? []).filter((i) => i.category !== "otro").map((i) => `${i.tooth ?? "-"} ${i.kind} ${i.category}`).sort();
const odo = (p) => p.odontogram.filter((i) => !i.advisory && !i.conflict).map((i) => `${i.tooth} ${i.status ?? `${i.surface}:${i.finding?.condition}`}`).sort();

const CASE_3312 = "El paciente manifiesta dolor intenso en la zona anterior. Examen: movilidad dentaria grado dos en la pieza 26. Se realiza conexión de implante en la zona de las piezas 20 y 21 aproximadamente mediante minipilar con manga de 2,5 milímetros. Se extrae la pieza 26. Escaneo completo de cinco implantes con scanbody y minipilar, doble escaneo con barra de acrílico para buscar pasividad. Plan: próxima entrega rehabilitar mitad del arco inferior izquierdo conectando piezas 25 y 30 con puente de PMMA; si no hay pasividad, cortar y unir con acrílico.";

test("caso 3312: 20 y 21 con pilar, 26 extraída (no implante), plan de puente sin marcar, CIE-11 sugerido y «la paciente»", async () => {
  const p = await run(CASE_3312, { patient: { sex: "F", age: 61 } });
  assert.deepEqual(odo(p), ["32 Ausente", "44 Implante", "45 Implante"]);
  const pr = p.prestaciones.map((i) => `${i.code} ${i.tooth ?? "-"}${i.advisory ? " aviso" : ""}`).sort();
  assert.ok(pr.includes("5003001 32"), pr.join());
  assert.ok(pr.includes("5011052 44") && pr.includes("5011052 45"), pr.join());
  assert.ok(pr.includes("9150001 - aviso"), "el escaneo se propone sin marcar");
  const dx = p.diagnoses.find((d) => d.tooth === 32);
  assert.equal(dx.code, "DA0C.Z");
  assert.ok(dx.suggested, "la movilidad II sugiere, no afirma");
  assert.ok(items(p).includes("31 plan puente") && items(p).includes("36 plan puente"));
  assert.ok(!items(p).some((i) => /realizado puente/.test(i)));
  assert.doesNotMatch(p.evolution.body, /El paciente|aproximadamente/);
  assert.match(p.evolution.body, /La paciente/);
  assert.ok(p.itemWarnings.some((w) => /aproximadamente/.test(w)));
});

test("la lista separa diagnóstico, plan y realizado en frases mixtas", async () => {
  assert.deepEqual(items(await run("Se obtura la 14 y se planifica endodoncia de la 19.")), ["26 realizado obturacion", "46 plan endodoncia"]);
  assert.deepEqual(items(await run("Plan: instalar implante en la 3.5 en tres meses, por ahora se extrae y se deja injerto.")), ["35 plan implante", "35 realizado exodoncia"]);
  assert.deepEqual(items(await run("Si persiste el dolor, se realizará endodoncia de la 2.6.")), ["26 plan endodoncia"]);
});

test("varias piezas en una frase y tramos: un elemento por pieza", async () => {
  assert.deepEqual(items(await run("Se realiza exodoncia de las piezas 1.8 y 2.8.")), ["18 realizado exodoncia", "28 realizado exodoncia"]);
  assert.deepEqual(items(await run("Se planifica destartraje de la 4.4 a la 4.1.")), ["41 plan destartraje", "42 plan destartraje", "43 plan destartraje", "44 plan destartraje"]);
  assert.deepEqual(expandRange(13, 23), [13, 12, 11, 21, 22, 23]);
  assert.deepEqual(expandRange(14, 46), []);
});

test("lo planificado o no realizado nunca queda hecho en el odontograma ni se cobra marcado", async () => {
  const planned = await run("Examen intraoral. Se detecta que la pieza 30 está ausente. Se planifica un implante en la pieza 30.");
  assert.deepEqual(odo(planned), ["36 Ausente"]);
  assert.ok(items(planned).includes("36 plan implante"));
  assert.deepEqual(planned.diagnoses.map((d) => [d.tooth, d.code]), [[36, "DA0A.1"]]);
  const notDone = await run("No se realiza la exodoncia de la 3.8 por falta de tiempo; queda pendiente.");
  assert.deepEqual(odo(notDone), []);
  assert.ok(notDone.prestaciones.every((i) => i.advisory), "la exodoncia no realizada queda sin marcar");
});

test("exodoncia → ausente + arancel con pieza; movilidad II–III sin diagnóstico → CIE-11 sugerido", async () => {
  const p = await run("Se realiza exodoncia de la pieza 17 por movilidad grado tres.");
  assert.deepEqual(odo(p), ["48 Ausente"]);
  assert.deepEqual(p.prestaciones.map((i) => [i.code, i.tooth]), [["5003001", 48]]);
  assert.deepEqual(p.diagnoses.map((d) => [d.tooth, d.code, Boolean(d.suggested)]), [[48, "DA0C.Z", true]]);
  const mob = await run("Se observa movilidad grado dos en las piezas 3.1 y 4.1.");
  assert.deepEqual(mob.diagnoses.map((d) => d.tooth).sort(), [31, 41]);
  assert.equal((await run("Se observa movilidad grado uno en la pieza 3.1.")).diagnoses.length, 0, "grado I no sugiere");
});

test("«rehabilitación incluida» no es diente incluido; «circónio» → «circonio»", async () => {
  const p = await run("Pieza 30 ausente. Costo del implante 1.490.000 pesos con rehabilitación oral de circónio incluida.");
  assert.ok(!p.diagnoses.some((d) => d.code === "DA07.7"));
  assert.match(p.corrected.text, /circonio/);
  const molar = await run("Cirugía de tercer molar inferior derecho 48 incluido, osteotomía y odontosección.");
  assert.ok(molar.diagnoses.some((d) => d.code === "DA07.7" && d.tooth === 48));
});

test("tipo de cada frase", () => {
  const no = () => false;
  assert.equal(kindOf("Se planifica corona en la 4.6.", null, no), "plan");
  assert.equal(kindOf("Se extrae la pieza 26.", null, no), "realizado");
  assert.equal(kindOf("Extracción de la pieza 26.", "procedimientos", no), "realizado");
  assert.equal(kindOf("Extracción de la pieza 26.", null, no), "diagnostico");
  assert.equal(kindOf("Próxima entrega rehabilitar mitad del arco.", null, no), "plan");
  assert.equal(kindOf("Finalmente no se instaló el implante.", null, no), "plan");
  assert.equal(kindOf("Movilidad grado II en la 26.", "examen", no), "diagnostico");
  assert.equal(kindOf("Refiere dolor.", "relato", no), null);
});

test("concordancia y «aproximadamente»: solo con sexo registrado o deducido con certeza", () => {
  assert.equal(polishNote("El paciente refiere dolor. Se indica al paciente control.", { sex: "F" }).body, "La paciente refiere dolor. Se indica a la paciente control.");
  assert.equal(polishNote("El paciente refiere dolor.", { sex: null }).body, "El paciente refiere dolor.");
  assert.equal(polishNote("Conexión en las piezas 20 y 21, aproximadamente, con minipilar.", undefined).body, "Conexión en las piezas 20 y 21, con minipilar.");
  assert.equal(polishNote("Dolor de aproximadamente 3 días.", undefined).body, "Dolor de aproximadamente 3 días.");
  assert.equal(inferSexFromName("Violeta Del Rosario Concha Herrera"), "F");
  assert.equal(inferSexFromName("Eduardo Barrenechea"), "M");
  assert.equal(inferSexFromName("Ariel Soto"), null);
  assert.equal(ageFrom("1965-07-14", "2026-11-16"), 61);
  assert.equal(ageFrom("14-07-1965", "2026-07-13"), 60);
  assert.equal(fdiToChile(36), 30);
  assert.equal(fdiToChile(45), 20);
});

test("el prompt lleva sexo y edad (sin identidad) y el esquema estricto pide la lista clínica", () => {
  const prompt = buildModelUserPrompt({ transcript: "Se extrae la pieza 26.", chart: [], patient: { sex: "F", age: 61 } });
  assert.match(prompt, /la paciente/);
  assert.match(prompt, /61 años/);
  assert.ok(AI_JSON_SCHEMA.required.includes("lista_clinica"));
  // Modelos sin esquema que omiten la lista: se completa vacía y las reglas la reconstruyen.
  assert.deepEqual(validateModelOutput({ nota: { examen: "x" } }).lista_clinica, []);
});

test("la lista de la IA se valida: pieza resoluble, cita literal, códigos del catálogo", () => {
  const resolve = (pieza) => (pieza === "26" ? { ok: true, tooth: 32 } : { ok: false, reason: "x" });
  const parsed = parseAiItems([
    { pieza: "26", sistema: "chilena", caras: [], tipo: "realizado", categoria: "exodoncia", descripcion: "exodoncia", codigo_arancel: "5003001", cie11: "DA0C.Z", evidencia: "se extrae la pieza 26" },
    { pieza: "99", sistema: "chilena", caras: [], tipo: "realizado", categoria: "exodoncia", descripcion: "x", codigo_arancel: "", cie11: "", evidencia: "se extrae la pieza 26" },
    { pieza: "26", sistema: "chilena", caras: [], tipo: "realizado", categoria: "implante", descripcion: "x", codigo_arancel: "9999999", cie11: "ZZZ", evidencia: "inventado" },
  ], resolve, (evidence) => evidence !== "inventado");
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].arancel, "5003001");
  assert.equal(parsed[0].cie11, "DA0C.Z");
  assert.equal(parsed[0].chile, 26);
});

test("IA que olvida la pieza 21 y pone implante en la 26: la lista lo corrige y deja avisos", async () => {
  const nota = { motivo: "", anamnesis: "La paciente manifiesta dolor intenso en la zona anterior.", alergias: "", medicamentos: "", examen: "Movilidad dentaria grado II en la pieza 26.", diagnostico: "", procedimientos: "Conexión de implante en las piezas 20 y 21 mediante minipilar. Extracción de la pieza 26.", plan: "Rehabilitar conectando piezas 25 y 30 con puente de PMMA.", indicaciones: "", presupuesto: "" };
  const hallazgo = (pieza, estado, evidencia) => ({ pieza, sistema: "chilena", tipo: "estado", condicion: "", estado, caras: [], profundidad: "", material: "", color: "", evidencia });
  const output = { nota, hallazgos: [hallazgo("20", "Implante", "conexión de implante en la zona de las piezas 20 y 21"), hallazgo("26", "Implante", "Se extrae la pieza 26")], procedimientos: [{ texto: "Conexión de implante", evidencia: "Se realiza conexión de implante", codigo: "5011052" }], presupuesto: [], ficha: [], texto_corregido: "", periodonto: [], pagos: [], citas: [], diagnosticos: [], diagnosticos_sugeridos: [], dudas: [], actos: [], lista_clinica: [] };
  const model = { id: "x", model: "x", complete: async () => ({ usedModel: "x", output }) };
  const { proposal } = await proposeFromTranscript({ transcript: CASE_3312, chart: [], patient: { sex: "F", age: 61 } }, model, () => {}, { today: "2026-11-16" });
  const states = proposal.odontogram.filter((i) => !i.advisory && !i.conflict).map((i) => `${i.tooth} ${i.status}`).sort();
  assert.ok(states.includes("32 Ausente"), states.join());
  assert.ok(!states.includes("32 Implante"), states.join());
  assert.ok(states.includes("44 Implante"), "la 21 (4.4) no se pierde ni queda sin marcar");
  assert.ok(proposal.prestaciones.some((i) => i.code === "5003001" && i.tooth === 32));
});

test("revisión IA: objeciones de numeración universal o «no válida en FDI» sobre números chilenos se descartan", async () => {
  const { wrongNumberingClaim } = await import("../lib/dictation/clinical-review.ts");
  assert.equal(wrongNumberingClaim("La pieza 30 en nomenclatura universal equivale a FDI 4.6"), true);
  assert.equal(wrongNumberingClaim("Se consigna «pieza 30», nomenclatura no válida en FDI"), true);
  assert.equal(wrongNumberingClaim("La pieza 45 no es válida en FDI"), false);
  assert.equal(wrongNumberingClaim("Falta describir la profundidad de la caries"), false);
});
