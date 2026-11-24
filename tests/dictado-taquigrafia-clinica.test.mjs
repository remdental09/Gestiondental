import test from "node:test";
import assert from "node:assert/strict";
import { expandClinicShorthand, faceCodeWords, clinicShorthandPrompt } from "../lib/dictation/clinic-shorthand.ts";
import { proposeFromTranscript, guardPlannedStatuses, includedTeeth, toothGroupSpans } from "../lib/dictation/proposal.ts";
import { classifyEvolution } from "../lib/dictation/evolution-type.ts";
import { suggestPrestaciones } from "../lib/dictation/prestaciones.ts";
import { ruleItems } from "../lib/dictation/clinical-items.ts";
import { buildEvolutionLines, pieceChips } from "../lib/evolution-lines.ts";
import { dentalDictionaryHints } from "../lib/dictation/dental-lexicon.ts";
import { readFileSync } from "node:fs";

// Textos sintéticos con la taquigrafía de ficha (estilo Dentalsoft). Ninguno es una evolución real.
const run = async (text) => (await proposeFromTranscript({ transcript: text, chart: [] }, null, () => {}, { today: "2026-11-24", sensitivity: "basic" })).proposal;
const surfaces = (p) => p.odontogram.filter((o) => o.kind === "surface").map((o) => `${o.tooth}${o.surface}:${o.finding?.condition}`).sort();
const states = (p) => p.odontogram.filter((o) => o.kind !== "surface").map((o) => `${o.tooth}:${o.status}`).sort();
const tools = { sentences: (t) => t.split(/(?<=[.!?])\s+/), teethIn: (t) => [...t.matchAll(/\b([1-8])\.([1-8])\b/g)].map((m) => Number(m[1]) * 10 + Number(m[2])), isPlan: () => false, formatFdi: (n) => `${Math.floor(n / 10)}.${n % 10}` };

// 1) Glosario
test("Rc con caras: «Pza 1.4 Rc DO Denticlean-Cap Hib SB-A2 P60» es una restauración de resina compuesta, no caries ni pulido", async () => {
  const { text } = expandClinicShorthand("Pza 1.4 Rc DO Denticlean-Cap Hib SB-A2 P60/ Pulido/ control de oclusión");
  assert.match(text, /^Pieza 1\.4 restauración de resina compuesta distal y oclusal/);
  assert.match(text, /capa híbrida/);
  assert.match(text, /adhesivo Single Bond/);
  assert.match(text, /color A2/);
  assert.match(text, /resina Filtek P60/);
  const p = await run("Pza 1.4 Rc DO Denticlean-Cap Hib SB-A2 P60/ Pulido/ control de oclusión");
  assert.deepEqual(surfaces(p), ["14D:restored", "14O:restored"]);
  assert.ok(!(p.diagnoses ?? []).some((d) => d.code.startsWith("DA08.0")), "una resina hecha no es caries");
  assert.ok((p.prestaciones ?? []).some((x) => x.code === "5005018" && x.tooth === 14), "resina de dos caras, posterior");
  assert.match(p.evolution.title, /^Obturación/);
});

test("varias piezas con sus caras en orden: «Pzas 4.4-4.5-3.4 Rc O-MOV-DO-» reparte una cara por pieza", () => {
  const { text } = expandClinicShorthand("Pzas 4.4-4.5-3.4 Rc O-MOV-DO- denticlean-Cap Hib SBU-A3 Z250");
  assert.match(text, /pieza 4\.4 restauración de resina compuesta oclusal; pieza 4\.5 restauración de resina compuesta mesial, oclusal y vestibular; pieza 3\.4 restauración de resina compuesta distal y oclusal/i);
});

test("Rc cervical en varias piezas comparte la cara; «Pzas1.2» sin espacio también se lee", async () => {
  const p = await run("Pzas 3.3-3.4 Rc CV -Denticlean-Cap Hib SB-A3 Z250/ Pulido");
  assert.deepEqual(surfaces(p), ["33V:restored", "34V:restored"]);
  assert.match(expandClinicShorthand("Pzas1.2-1.1 se realiza alargamiento").text, /^Piezas 1\.2-1\.1/);
});

test("caras escritas con letras", () => {
  assert.equal(faceCodeWords("DO"), "distal y oclusal");
  assert.equal(faceCodeWords("MOV"), "mesial, oclusal y vestibular");
  assert.equal(faceCodeWords("CV"), "cervical vestibular");
  assert.equal(faceCodeWords("P"), "palatino");
  assert.equal(faceCodeWords("XYZ"), null);
});

test("endodoncia en taquigrafía: Cdto = conducto, OBC = obturación de conductos, A2% = anestesia; las longitudes no son piezas", async () => {
  const { text } = expandClinicShorthand("Pza 2.5 Trepanación Endodóntica / Cdto U 21.5mm-ref cusp V-RB40-XPF / NaOCl-EDTA-Suero / OBC Guta y Totalfill / VI / A2% 1 tubo");
  assert.match(text, /conducto U 21,5 mm/);
  assert.match(text, /lima XP-endo Finisher/);
  assert.match(text, /obturación de conductos gutapercha y Totalfill/);
  assert.match(text, /anestesia al 2% 1 tubo/);
  assert.doesNotMatch(text, /Cdto|OBC/);
  const p = await run("Pza 2.5 Trepanación Endodóntica / Cdto U 21.5mm-ref cusp V-RB40-XPF / NaOCl-EDTA-Suero / OBC Guta y Totalfill / VI / A2% 1 tubo");
  assert.match(p.evolution.title, /^Endodoncia/);
  assert.ok(!p.odontogram.some((o) => o.tooth === 21), "21,5 mm no es la pieza 2.1");
});

test("los colores con % son anestesia y sin % son color; «B/W» y las fechas no se cortan", () => {
  assert.match(expandClinicShorthand("A4% 1 tubo spix").text, /anestesia al 4% 1 tubo/);
  assert.match(expandClinicShorthand("Rc V-Denticlean-Cap Hib SB- A2 z250").text, /color A2/);
  const t = expandClinicShorthand("Paciente acude a control. Rx B/W x2 / Pulido. Con fecha 16/03/2026").text;
  assert.match(t, /B\/W/);
  assert.match(t, /16\/03\/2026/);
  assert.match(t, /x2\. Pulido/);
});

test("PFP = prótesis fija plural; el glosario llega al prompt de la IA", async () => {
  assert.match(expandClinicShorthand("Cementación de PFP con Ketac Cem").text, /prótesis fija plural/);
  assert.match(clinicShorthandPrompt(), /OBC = obturación de conductos/);
  assert.match(dentalDictionaryHints(), /Rc .*resina compuesta/);
  const p = await run("Cementación de PFP con Ketac Cem / ajuste de oclusión");
  assert.equal(p.evolution.title, "Prótesis");
});

test("las correcciones quedan visibles con su motivo", async () => {
  const { corrections } = expandClinicShorthand("Pza 1.1 Rc P");
  assert.ok(corrections.some((c) => /Rc = restauración de resina compuesta/.test(c.reason ?? "")));
});

// 2) Plan vs realizado
test("«se decide exo e implante» no deja Implante; «para luego realizar coronas» no deja Corona", () => {
  const out = guardPlannedStatuses([{ id: "a", tooth: 46, kind: "status", status: "Implante" }], "Pieza 4.6 con mal pronóstico protésico - se decide exo e implante");
  assert.equal(out.odontogram.length, 0);
  const crowns = guardPlannedStatuses([{ id: "b", tooth: 11, kind: "crown", status: "Corona" }], "Pieza 1.1 se agrega composite / para luego tallar y hacer coronas");
  assert.equal(crowns.odontogram.length, 0);
  const done = guardPlannedStatuses([{ id: "c", tooth: 36, kind: "crown", status: "Corona" }], "Se cementa corona de zirconio en la 3.6.");
  assert.equal(done.odontogram.length, 1);
});

test("piezas incluidas, semierupcionadas o a desincluir no quedan Ausentes; una extracción de incluido sí", () => {
  const text = "Derivada para desinclusión de 3.8 y 4.8. Examen: 1.8 ausente, 2.7 semierupcionado. En la tomografía 1.7 incluido.";
  const inc = includedTeeth(text);
  for (const t of [38, 48, 27, 17]) assert.ok(inc.has(t), String(t));
  assert.ok(!inc.has(18));
  assert.ok(!includedTeeth("Extracción de la 3.8 incluida con osteotomía.").has(38));
});

test("ítems: «se decide», «para luego», «derivado para» y «escaneo para coronas» son plan", () => {
  const items = ruleItems("Pieza 4.6 eliminación de recubrimiento; se decide exo e implante.", tools);
  assert.ok(items.some((i) => i.tooth === 46 && i.category === "implante" && i.kind === "plan"));
  const scan = ruleItems("Se realiza escaneo de implantes 2.4 y 2.5 para coronas.", tools);
  assert.ok(!scan.some((i) => i.category === "corona" && i.kind === "realizado"));
  assert.ok(!scan.some((i) => i.category === "implante" && i.kind === "realizado"), "escanear implantes no es instalarlos");
});

// 3) Estado copiado entre grupos
test("la corona de «Pzas 3.7-3.6» no pasa a las resinas de «Pzas 4.7-4.5-3.5»", async () => {
  const text = "Pzas 2.7-2.6 Corona Cerec HT/ Duolink-Futurabond/ Pulido\n\nPzas 3.7-3.4-4.5 Rc MO-V-DO- Cap Hib SB-A2 Z250 / Pulido";
  const spans = toothGroupSpans(expandClinicShorthand(text).text);
  assert.match(spans.get(27), /Corona/);
  const p = await run(text);
  assert.deepEqual(states(p), ["26:Corona", "27:Corona"]);
  assert.ok(surfaces(p).includes("34V:restored"));
  const guarded = guardPlannedStatuses([37, 34, 45, 27].map((t) => ({ id: `x${t}`, tooth: t, kind: "crown", status: "Corona" })), expandClinicShorthand(text).text);
  assert.deepEqual(guarded.odontogram.map((o) => o.tooth), [27]);
});

test("en el habla el acto va antes de la pieza: «se cementa corona en el 3.6. Implante en el 4.6» no se corta por grupos", () => {
  assert.equal(toothGroupSpans("Se cementa corona en el 3.6. Implante en el 4.6 con pilar.").size, 0);
});

// 4) Arancel
test("endodoncia terminada no es trepanación de urgencia; con la vitalidad dictada sale el tratamiento de conductos", () => {
  const coded = [{ text: "Trepanación endodóntica de la 2.5", code: "5001019" }];
  const out = suggestPrestaciones([], ["Pieza 2.5 trepanación endodóntica, conducto U 21 mm, obturación de conductos con gutapercha."], coded, "necrosis pulpar de la 2.5");
  assert.ok(!out.some((x) => x.code === "5001019"));
  assert.ok(out.some((x) => x.code === "5006008" && x.tooth === 25));
  const urgent = suggestPrestaciones([], ["Urgencia: trepanación de la 2.5 por dolor."], [{ text: "Trepanación de urgencia de la 2.5", code: "5001019" }]);
  assert.ok(urgent.some((x) => x.code === "5001019"), "la apertura de urgencia sigue siendo 5001019");
});

test("cementar una PFP no cobra «ajuste de plano oclusal»; con material dictado propone la inserción", () => {
  const out = suggestPrestaciones([], ["Cementación de prótesis fija plural de zirconio con Ketac Cem.", "Ajuste de oclusión."], [{ text: "Ajuste de oclusión", code: "5013035" }]);
  assert.ok(!out.some((x) => x.code === "5013035"));
  assert.ok(out.some((x) => x.code === "5007041"));
});

test("«control post exodoncia» o «zona donde se realizó la exodoncia» no cobran una extracción", async () => {
  const p = await run("Paciente acude a control post exodoncia de pieza 2.7. Se observa cicatrización normal.");
  assert.ok(!(p.prestaciones ?? []).some((x) => x.code === "5003001"));
  assert.doesNotMatch(p.evolution.title, /^Exodoncia/);
});

// 5) CIE-11
test("una corona hecha hoy en diente natural también pide su diagnóstico", async () => {
  const p = await run("Se cementa corona de disilicato en la 4.6 con cemento resinoso.");
  assert.ok((p.diagnosisPrompts ?? []).some((q) => q.tooth === 46 && /corona/.test(q.procedure)));
});

test("al guardar, los CIE-11 propuestos (dictados, AAE, deducidos o aproximados) parten marcados y el profesional los desmarca", () => {
  const src = readFileSync(new URL("../components/clinical-dictation.tsx", import.meta.url), "utf8");
  assert.match(src, /decision: dxStartsChecked\(item\) \? "accepted" as const : "rejected" as const/);
});

// 6) Historial
test("un renglón suelto no es un diagnóstico, y la etiqueta de la pieza no es «Pzas»", () => {
  const items = ruleItems("Pieza 1.7 / Aún drena pus.", tools);
  assert.ok(!items.some((i) => i.kind === "diagnostico" && i.category === "otro"));
  const lines = buildEvolutionLines({ items: [{ id: "i1", tooth: 26, surfaces: ["D", "O"], kind: "realizado", category: "obturacion", what: "Pza 2.6 Rc DO Denticlean / Pulido", evidence: "Pza 2.6 Rc DO", origin: "reglas" }], budgets: [] });
  const [chip] = pieceChips(lines);
  assert.doesNotMatch(chip.t, /Pza|Pzas/);
  assert.match(chip.t, /^2\.6 /);
});

test("en una sesión de endodoncia el vidrio ionómero es el sellado, no una obturación aparte", () => {
  const items = ruleItems("Pieza 2.5 obturación de conductos con gutapercha y vidrio ionómero.", tools);
  assert.ok(items.some((i) => i.category === "endodoncia" && i.kind === "realizado"));
  assert.ok(!items.some((i) => i.category === "obturacion"));
});

// 7) Ficha
test("guardar alergias desde el dictado no reenvía la identidad ni revalida un RUT que no cambia", () => {
  const src = readFileSync(new URL("../components/clinical-dictation.tsx", import.meta.url), "utf8");
  assert.match(src, /action: "updatePatient", patientId, allergies: fichaUpdate\.allergies, history: fichaUpdate\.history \}/);
  const route = readFileSync(new URL("../app/api/clinical/route.ts", import.meta.url), "utf8");
  assert.match(route, /const hasRut = rutSent !== null && rutSent !== \(patient\.rut \?\? ""\)\.trim\(\);/);
  assert.match(route, /\(hasPhone && !validPhone\(phone\)\) \|\| \(hasEmail && !validEmail\(email\)\)/);
});

test("clasificación: «Rc» gana a «Pulido»; «Control de PFP» sigue siendo control", () => {
  assert.equal(classifyEvolution(expandClinicShorthand("Pza 1.1 Rc P Denticlean / Pulido / Higiene").text).type, "obturacion");
  assert.equal(classifyEvolution(expandClinicShorthand("Control de PFP / Ok / se cita en 6 meses").text).type, "control");
});
