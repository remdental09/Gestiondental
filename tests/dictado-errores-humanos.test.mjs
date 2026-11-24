import test from "node:test";
import assert from "node:assert/strict";
import { structureTranscript, toothMentions, toothClause, maskInstrumentSizes } from "../lib/dictation/proposal.ts";
import { applySelfCorrections } from "../lib/dictation/spoken.ts";
import { actPairs } from "../lib/dictation/clinical-items.ts";

const teeth = (text) => toothMentions(text).filter((m) => m.ok).map((m) => m.tooth);
const tools = { sentences: (t) => [t], teethIn: teeth, isPlan: () => false, formatFdi: (n) => `${Math.floor(n / 10)}.${n % 10}` };

test("autocorrección con artículo: «la 16 por oclusal, no perdón, en la FDI 1.6» deja solo la 1.6", () => {
  const { text, corrections } = applySelfCorrections("le hice una obturación en la 16 por oclusal, no perdón, en la FDI 1.6 con resina compuesta.");
  assert.deepEqual(teeth(text), [16]);
  assert.ok(!/\bla 16\b/.test(text));
  assert.equal(corrections.length, 1);
  const p = structureTranscript(text, { today: "2026-11-23" });
  assert.deepEqual(p.odontogram.map((o) => o.tooth), [16]);
});

test("«la 20 de marzo … perdón 30» no se toma por pieza corregida", () => {
  const { text } = applySelfCorrections("Control la 20 de marzo, no perdón, la 30 de marzo.");
  assert.equal(text, "Control la 20 de marzo, no perdón, la 30 de marzo.");
});

test("el número de una lima («hasta la 25») no es una pieza", () => {
  assert.deepEqual(teeth("Instrumentación con limas rotatorias hasta la 25, hipoclorito."), []);
  assert.deepEqual(teeth("Conformación con lima número 30 en la 3.6."), [36]);
  assert.equal(maskInstrumentSizes("Se opera la 25"), "Se opera la 25", "sin lima ni instrumentación no se toca");
  assert.equal(teeth("Extracción de la 25.").length, 1, "«la 25» sin lima sigue siendo una pieza");
});

test("cada pieza usa solo su tramo: «Obturé la 1.6 oclusal y la 2.5 mesial» no cruza las caras", () => {
  assert.equal(toothClause("Obturé la 1.6 oclusal y la 2.5 mesial con resina compuesta", 16), "Obturé la 1.6 oclusal");
  const p = structureTranscript("Obturé la 1.6 oclusal y la 2.5 mesial con resina compuesta.", { today: "2026-11-23" });
  assert.deepEqual(p.odontogram.map((o) => `${o.tooth}${o.surface}`).sort(), ["16O", "25M"]);
});

test("una lista con una sola descripción comparte la cara: «las piezas 1.6 y 2.6» oclusal sigue funcionando", () => {
  const p = structureTranscript("Se aplica sellante de fosas y fisuras en las piezas 1.6 y 2.6.", { today: "2026-11-23" });
  assert.deepEqual(p.odontogram.map((o) => `${o.tooth}${o.surface}`).sort(), ["16O", "26O"]);
});

test("el plan reparte cada tratamiento a sus piezas, sin cruzarlos con todas", () => {
  const part = "Plan: obturar 1.6 y 2.5, endodoncia en la 3.6 y después corona";
  const pairs = actPairs(part, teeth(part), ["obturacion", "endodoncia", "corona"], tools);
  assert.ok(pairs, "se pudo repartir");
  const key = (p) => `${p.category}:${p.tooth}`;
  assert.deepEqual(pairs.map(key).sort(), ["corona:36", "endodoncia:36", "obturacion:16", "obturacion:25"]);
});

test("sin tramos separables, actPairs devuelve null y queda el cruce de siempre", () => {
  assert.equal(actPairs("Se obtura y se hace endodoncia en las piezas 1.6 y 2.6", [16, 26], ["obturacion", "endodoncia"], tools), null);
});

test("«la muela 36 no, la 46 perdón» deja solo la 46", () => {
  const { text, corrections } = applySelfCorrections("Vino por dolor, la muela 36 no, la 46 perdón, tiene una fractura de cúspide.");
  assert.deepEqual(teeth(text), [46]);
  assert.equal(corrections.length, 1);
  assert.equal(applySelfCorrections("Control en la muela 36 no, la 20 de marzo perdón.").corrections.length, 0, "un día del mes no es una pieza");
});

test("«Hoy no hice nada, solo planifico…» deja las coronas en plan, nunca realizadas", async () => {
  const { kindOf } = await import("../lib/dictation/clinical-items.ts");
  const never = () => false;
  assert.equal(kindOf("Hoy no hice nada, solo planifico un onlay cerámico en la 4.6 y una corona en la 1.6 para después.", null, never), "plan");
  assert.equal(kindOf("Hoy no hicimos la corona.", null, never), "plan");
  assert.equal(kindOf("Hoy se realiza la obturación de la 1.6.", null, never), "realizado", "lo hecho hoy sigue siendo realizado");
  const p = structureTranscript("Hoy no hice nada, solo planifico una corona en la 1.6 para después.", { today: "2026-11-23" });
  assert.ok(!p.odontogram.some((o) => o.tooth === 16 && /corona/i.test(String(o.status ?? o.finding?.condition ?? "")) && !o.planned && o.origin !== "plan"), "no queda corona hecha en la 1.6");
});

test("tallado para corona + provisoria + «la definitiva viene en dos semanas» no deja la pieza con corona", async () => {
  const { kindOf } = await import("../lib/dictation/clinical-items.ts");
  const t = "Hoy tallé la 1.6 para corona de zirconio, tomé impresión con silicona y dejé una corona provisoria de acrílico cementada con cemento temporal. La corona definitiva viene en dos semanas.";
  const p = structureTranscript(t, { today: "2026-11-23" });
  assert.deepEqual(p.odontogram, [], "ni la provisoria ni la definitiva futura cambian el odontograma");
  assert.equal(kindOf("La corona definitiva viene en dos semanas.", null, () => false), "plan");
  assert.equal(kindOf("Se realiza obturación de la 1.6, control en dos semanas.", null, () => false), "realizado");
});

test("sondaje de dos piezas: cada una conserva su tramo, con su medida y su sitio", async () => {
  const { ruleItems } = await import("../lib/dictation/clinical-items.ts");
  const items = ruleItems("Sondaje de 5 milímetros por distal de la 4.6 con sangrado, y de 4 por mesial de la 4.5.", tools);
  const of = (tooth) => items.find((i) => i.tooth === tooth)?.evidence ?? "";
  assert.match(of(46), /5 mil[ií]metros por distal/);
  assert.doesNotMatch(of(46), /mesial/);
  assert.match(of(45), /4 por mesial/);
  assert.doesNotMatch(of(45), /distal/);
});

test("raspaje y alisado radicular cuenta como destartraje realizado, y un onlay planificado como restauración en plan", async () => {
  const { ruleItems } = await import("../lib/dictation/clinical-items.ts");
  const rar = ruleItems("Hoy hice raspaje y alisado radicular del cuadrante 4.", { ...tools, isPlan: () => false });
  assert.ok(rar.some((i) => i.category === "destartraje" && i.kind === "realizado"));
  const onlay = ruleItems("Planifico un onlay cerámico en la 4.6.", tools);
  assert.ok(onlay.some((i) => i.tooth === 46 && i.category === "obturacion" && i.kind === "plan"));
});

test("lo que el dictado dice que ya se hizo no se queda bajo «Plan de tratamiento» de la nota", async () => {
  const { movePerformedOutOfPlan } = await import("../lib/dictation/proposal.ts");
  const nota = { procedimientos: "", plan: "Se realiza destartraje supragingival y subgingival en toda la boca con ultrasonido. Se programa control en 15 días." };
  movePerformedOutOfPlan(nota, "Hoy hice destartraje supra y subgingival en toda la boca con ultrasonido. Control en 15 días.");
  assert.match(nota.procedimientos, /destartraje/);
  assert.match(nota.plan, /control/i);
  assert.doesNotMatch(nota.plan, /destartraje/);
  const futuro = { procedimientos: "", plan: "Se realiza destartraje en la próxima sesión." };
  movePerformedOutOfPlan(futuro, "Se planifica destartraje para la próxima sesión.");
  assert.match(futuro.plan, /destartraje/, "un plan real no se mueve");
});

// ── Lote de simulaciones con errores humanos (Ana, sin ortodoncia) ──────────────────────────────
const lote = async (t) => (await import("../lib/dictation/clinical-items.ts")).ruleItems(t, { ...tools, isPlan: () => false });
const has = (items, tooth, kind, category) => items.some((i) => i.tooth === tooth && i.kind === kind && i.category === category);

test("lote: la primera persona del pasado («restauré», «cementé», «apliqué», «hice») es realizado", async () => {
  assert.ok(has(await lote("Le apliqué sellante en la 1.7 y la 2.7 en las fosas y fisuras."), 17, "realizado", "sellante"));
  assert.ok(has(await lote("Cementé el onlay cerámico en la 4.6 con cemento de resina dual."), 46, "realizado", "obturacion"));
  assert.ok(has(await lote("Hice carillas de resina en la 1.1 y la 2.1."), 21, "realizado", "obturacion"));
  assert.ok(has(await lote("Urgencia: absceso en la 1.2, hice trepanación y drenaje."), 12, "realizado", "endodoncia"));
});

test("lote: «fosas y fisuras» no es fractura; el cemento de resina no es una obturación", async () => {
  assert.ok(!(await lote("Le apliqué sellante en la 1.7 en las fosas y fisuras.")).some((i) => i.category === "fractura"));
  assert.ok(!has(await lote("Hoy cementé la corona de zirconio definitiva en la 1.6 con cemento de resina."), 16, "realizado", "obturacion"));
});

test("lote: endodoncia y retratamiento se reconocen por sus actos; lo de «después» queda en plan", async () => {
  assert.ok(has(await lote("Apertura cameral de la 2.5, conductometría a 21 milímetros, instrumenté hasta la lima 30."), 25, "realizado", "endodoncia"));
  const re = await lote("Retratamiento de la 1.1, desobturé con limas reciproc. Después obturo los conductos y hago el muñón.");
  assert.ok(has(re, 11, "realizado", "endodoncia"));
  assert.ok(!has(re, 11, "realizado", "obturacion"), "«después obturo» no es una obturación hecha");
});

test("lote: «la 3.4 tiene una abfracción que dejo para después» queda en plan y no como restaurada", async () => {
  const items = await lote("Restauré lesiones cervicales no cariosas en la 1.3 y la 2.3 por vestibular con ionómero de vidrio, y la 3.4 tiene una abfracción que dejo para después.");
  assert.ok(has(items, 13, "realizado", "obturacion") && has(items, 23, "realizado", "obturacion"));
  assert.ok(!items.some((i) => i.tooth === 34 && i.kind === "realizado"));
  const p = structureTranscript("Restauré lesiones cervicales no cariosas en la 1.3 y la 2.3 por vestibular con ionómero de vidrio.", { today: "2026-11-24" });
  assert.deepEqual(p.odontogram.map((o) => `${o.tooth}${o.surface}`).sort(), ["13V", "23V"], "la cara dicha al final vale para las dos");
});

test("lote: «la 4.8 incluida, no la 3.8 perdón» deja solo la 3.8; «planifico prótesis… tomé impresión» es plan", async () => {
  const { text } = applySelfCorrections("Al examen veo la 4.8 incluida, no la 3.8 perdón, en posición mesioangulada.");
  assert.deepEqual(teeth(text), [38]);
  assert.ok(has(await lote("Planifico prótesis removible inferior para reemplazar la 3.6 y la 4.7, tomé impresión con alginato."), 36, "plan", "protesis"));
});

test("lote: la exodoncia quirúrgica con colgajo de la evolución cobra la extracción a colgajo, no la simple", async () => {
  const { proposeFromTranscript } = await import("../lib/dictation/proposal.ts");
  const r = await proposeFromTranscript({ transcript: "Hoy le saqué la 3.8, exodoncia quirúrgica con colgajo y osteotomía, sutura.", chart: [] }, null, () => {}, { today: "2026-11-24" });
  const codes = (r.proposal ?? r).prestaciones.map((x) => x.code);
  assert.ok(codes.includes("5003002") && !codes.includes("5003001"));
});

test("lote: un diagnóstico dictado sin pieza cubre la única pieza tratada (no se pide de nuevo)", async () => {
  const { deducedDiagnoses } = await import("../lib/dictation/proposal.ts");
  const odo = [{ id: "o", tooth: 16, kind: "surface", surface: "O", finding: { condition: "restored" }, origin: "reglas", numbering: "FDI", numberingLabel: "FDI 1.6", sourceText: "", evidence: "" }];
  const dx = [{ id: "d", code: "DA08.0", title: "Caries dental", label: "", evidence: "", findings: "", origin: "reglas" }];
  assert.equal(deducedDiagnoses(odo, dx, "Diagnóstico caries. Obturé la 1.6 oclusal con resina.").prompts.length, 0);
  assert.equal(deducedDiagnoses(odo, [], "Obturé la 1.6 oclusal con resina.").prompts.length, 1, "sin diagnóstico sí pregunta");
});
