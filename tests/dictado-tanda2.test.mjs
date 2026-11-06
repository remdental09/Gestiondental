import test from "node:test";
import assert from "node:assert/strict";
import { proposeFromTranscript } from "../lib/dictation/proposal.ts";

const quick = async (transcript) => (await proposeFromTranscript({ transcript, chart: [] }, null, () => {}, { today: "2026-11-06" })).proposal;
const surfaces = (proposal) => proposal.odontogram.map((item) => [item.tooth, item.surface, item.finding?.condition]);

test("«la 37» sin la palabra pieza se lee como FDI 3.7 cuando no puede ser un día del mes", async () => {
  const proposal = await quick("Caries de dentina profunda en oclusal de la 37.");
  assert.deepEqual(surfaces(proposal), [[37, "O", "caries"]]);
  assert.equal(proposal.clarifications.length, 0);
});

test("una fecha («el 15 de noviembre») no se toma por pieza", async () => {
  const proposal = await quick("Control el 36 de noviembre y el 15 de noviembre.");
  assert.equal(proposal.odontogram.length, 0);
  assert.ok(!proposal.clarifications.some((text) => /pieza/i.test(text)));
});

test("«las piezas 1.6 y 2.6» marca el sellante en ambas piezas, cara oclusal", async () => {
  const proposal = await quick("Se aplica sellante de fosas y fisuras en las piezas 1.6 y 2.6.");
  assert.deepEqual(surfaces(proposal).sort(), [[16, "O", "sealant"], [26, "O", "sealant"]]);
});

test("el sellante de fosas y fisuras en una pieza deja la cara oclusal sin preguntar", async () => {
  const proposal = await quick("Se aplica sellante de fosas y fisuras en la pieza 1.6.");
  assert.deepEqual(surfaces(proposal), [[16, "O", "sealant"]]);
  assert.equal(proposal.clarifications.length, 0);
});

test("la fractura coronaria toma la pieza de su frase aunque el corte la deje en otra cláusula", async () => {
  const proposal = await quick("Fractura coronaria complicada de la pieza 1.1 con exposición pulpar.");
  const fracture = proposal.diagnoses.find((item) => item.code.startsWith("NA0D"));
  assert.ok(fracture);
  assert.equal(fracture.tooth, 11);
});

test("«tercer molar inferior derecho 48 incluido» vincula el diagnóstico a la pieza 4.8", async () => {
  const proposal = await quick("Cirugía de tercer molar inferior derecho 48 incluido, osteotomía y odontosección.");
  const retained = proposal.diagnoses.find((item) => item.code === "DA07.7");
  assert.ok(retained);
  assert.equal(retained.tooth, 48);
});

test("«Exodoncia de la pieza 8.4» sin verbo pregunta si se hizo y no cambia el estado", async () => {
  const proposal = await quick("Exodoncia de la pieza 8.4 por movilidad fisiológica, sin complicaciones.");
  assert.equal(proposal.odontogram.length, 0);
  assert.ok(proposal.clarifications.some((text) => /ya se realiz/.test(text)));
});

test("«Se realiza exodoncia de la pieza 8.4» sí la deja ausente y no pregunta", async () => {
  const proposal = await quick("Se realiza exodoncia de la pieza 8.4.");
  assert.deepEqual(proposal.odontogram.map((item) => [item.tooth, item.status]), [[84, "Ausente"]]);
  assert.ok(!proposal.clarifications.some((text) => /ya se realiz/.test(text)));
});

test("un diagnóstico dictado para dos piezas en la misma frase se registra en cada una", async () => {
  const proposal = await quick("Abfracción en las piezas 1.3 y 2.3.");
  const teeth = proposal.diagnoses.filter((item) => item.code).map((item) => item.tooth).sort();
  assert.deepEqual(teeth, [13, 23]);
});

test("sondaje con sitios compuestos y profundidades sin unidad: una lectura por sitio", async () => {
  const proposal = await quick("Sondaje pieza 3.7 mesiovestibular 4 milímetros con sangrado, vestibular 3, distovestibular 5 con supuración.");
  assert.deepEqual(proposal.perio.map((item) => [item.tooth, item.site, item.depth, item.bleeding, item.suppuration]), [[37, "MV", 4, true, false], [37, "V", 3, false, false], [37, "DV", 5, false, true]]);
  assert.equal(proposal.clarifications.length, 0);
});

test("«Se restaura con resina compuesta» sin cara usa la cara recién dictada de esa pieza", async () => {
  const proposal = await quick("Caries de dentina profunda en oclusal de la pieza 3.7. Se restaura con resina compuesta.");
  const restored = proposal.odontogram.filter((item) => item.tooth === 37 && item.surface === "O" && item.finding?.condition === "restored");
  assert.equal(restored.length, 1);
  assert.ok(!proposal.clarifications.some((text) => /Falta la superficie/.test(text)));
});

const planOnly = async (text) => (await quick(text));

test("«Plan de tratamiento» no marca el odontograma como hecho (obturación, corona, implante)", async () => {
  const a = await planOnly("Se observa caries de dentina profunda en la cara oclusal de la pieza 4.6. Plan de tratamiento: obturación con resina compuesta oclusal de la 4.6. Presupuesto: obturación con resina compuesta, cincuenta y cinco mil pesos.");
  assert.ok(!a.odontogram.some((item) => item.finding?.condition === "restored"), "la obturación planificada no queda restaurada");
  assert.ok(a.odontogram.some((item) => item.finding?.condition === "caries"), "la caries sí se registra");
  const b = await planOnly("Plan de tratamiento en dos fases. Fase uno: endodoncia en la 3.6. Fase dos: reconstrucción con muñón y corona metal cerámica en la 3.6, trescientos veinte mil pesos.");
  assert.ok(!b.odontogram.some((item) => item.kind === "crown" || item.status === "Corona"));
  const c = await planOnly("Pieza 2.4 ausente. Plan opción A: implante unitario en la 2.4, seiscientos cincuenta mil pesos, y corona sobre implante, trescientos cincuenta mil pesos.");
  assert.deepEqual(c.odontogram.map((item) => [item.tooth, item.status ?? item.kind]), [[24, "Ausente"]]);
});

test("«se evalúa implante o puente, a decidir» no marca implante", async () => {
  const proposal = await planOnly("Pieza 3.5 con resto radicular. Luego se evalúa implante o puente, a decidir con el paciente.");
  assert.ok(!proposal.odontogram.some((item) => item.status === "Implante"));
});

test("lo realizado después del plan sí se registra", async () => {
  const proposal = await planOnly("Plan de tratamiento: exodoncia de la 4.8. Se realiza exodoncia de la pieza 4.8 sin complicaciones.");
  assert.ok(proposal.odontogram.some((item) => item.tooth === 48 && item.status === "Ausente"));
});

test("la prestación del presupuesto no arrastra el monto dicho en palabras ni el número de pieza partido", async () => {
  const proposal = await planOnly("Presupuesto de exodoncia simple de la pieza 3.8 por cuarenta mil pesos.");
  const item = proposal.budget[0];
  assert.ok(item);
  assert.equal(item.amount, 40000);
  assert.ok(!/cuarenta|mil|\b3 8\b/i.test(item.label), item.label);
  assert.equal(item.catalogCode, "5003001");
});

test("montos dictados en palabras se usan en el presupuesto de la IA", async () => {
  const { spokenAmounts } = await import("../lib/dictation/spoken.ts");
  assert.deepEqual(spokenAmounts("ciento ochenta mil pesos").map((a) => a.value), [180000]);
});

test("«Ausencia del 2.4» marca la pieza ausente y «ausencia de sangrado» no", async () => {
  const run = async (transcript) => (await proposeFromTranscript({ transcript, chart: [] }, null, () => {}, { today: "2026-11-06" })).proposal;
  const a = await run("Ausencia del 2.4. Plan de tratamiento opción A: implante con corona en el 2.4, novecientos mil pesos.");
  assert.deepEqual(a.odontogram.map((o) => [o.tooth, o.status]), [[24, "Ausente"]]);
  const b = await run("Ausencia de sangrado al sondaje.");
  assert.equal(b.odontogram.length, 0);
});

test("gingivitis generalizada asociada a placa se propone como diagnóstico sin código", async () => {
  const p = (await proposeFromTranscript({ transcript: "Gingivitis generalizada asociada a placa. Plan de tratamiento: profilaxis dental.", chart: [] }, null, () => {}, { today: "2026-11-06" })).proposal;
  assert.ok(p.diagnoses.some((d) => /Gingivitis inducida por placa/.test(d.title) && !d.code));
});

test("fase y opción del plan se leen de lo dictado", async () => {
  const { budgetContext } = await import("../lib/dictation/proposal.ts");
  const t = "Plan de tratamiento fase uno: endodoncia del 3.6, ciento ochenta mil pesos, y reconstrucción con resina, sesenta mil pesos. Fase dos: corona metal cerámica del 3.6, doscientos veinte mil pesos.";
  assert.deepEqual(budgetContext(t, "endodoncia del 3.6, ciento ochenta mil pesos"), { phase: "Fase 1" });
  assert.deepEqual(budgetContext(t, "reconstrucción con resina, sesenta mil pesos"), { phase: "Fase 1" });
  assert.deepEqual(budgetContext(t, "Fase dos: corona metal cerámica del 3.6, doscientos veinte mil pesos."), { phase: "Fase 2" });
  const o = "Plan de tratamiento opción A: implante con corona en el 2.4, novecientos mil pesos. Opción B: prótesis fija de tres unidades, cuatrocientos cincuenta mil pesos.";
  assert.deepEqual(budgetContext(o, "implante con corona en el 2.4, novecientos mil pesos."), { option: "A" });
  assert.deepEqual(budgetContext(o, "Opción B: prótesis fija de tres unidades, cuatrocientos cincuenta mil pesos."), { option: "B" });
  assert.deepEqual(budgetContext("Endodoncia, cien mil pesos.", "Endodoncia, cien mil pesos."), {});
});

test("la IA no puede dejar un plan como procedimiento realizado", async () => {
  const { validateAiExtraction } = await import("../lib/dictation/proposal.ts");
  const transcript = "Se observa caries oclusal en el 4.6. Plan de tratamiento: obturación con resina compuesta en el 4.6, cincuenta y cinco mil pesos.";
  const ai = validateAiExtraction({
    nota: { motivo: "", examen: "Se observa caries oclusal en el 4.6.", procedimientos: "Se planifica obturación con resina compuesta en la pieza 4.6.", plan: "Se plantea obturación en el 4.6.", presupuesto: "" },
    procedimientos: [{ texto: "Se planifica obturación con resina compuesta en la pieza 4.6.", evidencia: "Plan de tratamiento: obturación con resina compuesta en el 4.6" }],
    hallazgos: [], presupuesto: [], pagos: [], citas: [], ficha: [], periodonto: [], diagnosticos: [], dudas: [],
  }, transcript);
  assert.equal(ai.procedures.length, 0);
});

test("la relectura reconoce planes con varias prestaciones y alternativas", async () => {
  const { verifyDictationSave } = await import("../lib/dictation/proposal.ts");
  const budgets = [
    { id: "a", title: "Presupuesto dictado", label: "Implante con corona", amount: 900000, sourceText: "", phase: "Fase 1" },
    { id: "b", title: "Presupuesto dictado", label: "Prótesis fija", amount: 450000, sourceText: "", option: "B" },
    { id: "c", title: "Presupuesto dictado", label: "Control", amount: 20000, sourceText: "", phase: "Fase 1" },
  ];
  const snapshot = {
    notes: [], toothStatuses: {},
    budgets: [
      { id: 10, patientId: 1, title: "Presupuesto dictado", items: [{ label: "Implante con corona", amount: 900000 }, { label: "Control", amount: 20000 }], status: "Borrador", date: "", isAlternative: false, parentBudgetId: null },
      { id: 11, patientId: 1, title: "Presupuesto dictado · Opción B", items: [{ label: "Prótesis fija", amount: 450000 }], status: "Borrador", date: "", isAlternative: true, parentBudgetId: 10 },
    ],
  };
  const r = verifyDictationSave({ patientId: 1, before: { teeth: {}, surfaces: {} }, note: null, accepted: [], budgets, savedBudgetIds: [10, 11, 10] }, snapshot);
  assert.equal(r.ok, true, r.messages.join("\n"));
});

test("simulación 20: errores humanos del dictado", async () => {
  const run = async (transcript) => (await proposeFromTranscript({ transcript, chart: [] }, null, () => {}, { today: "2026-11-06" })).proposal;
  // Rectificación con «en la»: la 1.6 se anula.
  const a = await run("Se observa caries de dentina profunda oclusal y mesial en la uno seis, perdón, en la 4.6, y caries de dentina superficial vestibular en la 4.5.");
  assert.deepEqual(a.odontogram.map((o) => `${o.tooth}${o.surface}`).sort(), ["45V", "46M", "46O"]);
  // Los pilares no faltan; «ausencia» afecta solo a las piezas nombradas antes.
  const b = await run("Ausencia de la 2.5 y la 2.6, pilares la 2.4 y la 2.7. Se planifica prótesis fija plural, un millón doscientos mil pesos.");
  assert.deepEqual(b.odontogram.map((o) => o.tooth).sort(), [25, 26]);
  // Ausencia dentro de una frase con otros hallazgos; periodontitis sin pieza.
  const c = await run("Hoy se observa caries de dentina profunda en la 2.6 oclusal, periodontitis estadio tres, y ausencia de la 3.6.");
  assert.ok(c.odontogram.some((o) => o.tooth === 36 && o.status === "Ausente"));
  assert.ok(!c.odontogram.some((o) => o.tooth === 26 && o.status === "Ausente"));
  assert.ok(c.diagnoses.some((d) => /Periodontitis estadio III/.test(d.title) && d.tooth === undefined));
  // «Opción be», lucas y presupuesto sin la palabra «presupuesto».
  const d = await run("Plan opción A: implante en la 3.6, quinientos mil pesos. Opción be: puente de tres unidades, trescientas ochenta lucas.");
  assert.deepEqual(d.budget.map((x) => [x.label, x.amount, x.option]), [["Implante en la 3.6", 500000, "A"], ["Puente de tres unidades", 380000, "B"]]);
  // Un pago no cambia el odontograma.
  const e = await run("El paciente abona ciento cincuenta mil pesos en efectivo para el implante de la 3.6.");
  assert.equal(e.odontogram.length, 0);
});

test("budgetContext encuentra la fase con el texto corregido o el original", async () => {
  const { budgetContext } = await import("../lib/dictation/proposal.ts");
  const original = "fase uno endodoncia del 3.6 y fase dos corona del 3.6";
  const corrected = "Fase 1: endodoncia del 3.6. Fase 2: corona del 3.6";
  assert.equal(budgetContext([corrected, original], "corona del 3.6").phase, "Fase 2");
  assert.equal(budgetContext(["otro texto", original], "endodoncia del 3.6").phase, "Fase 1");
});

test("sondaje dictado: tres cifras por cara, cifras sin mm, central, sangrado general y movilidad de la pieza anterior", async () => {
  const { proposeFromTranscript } = await import("../lib/dictation/proposal.ts");
  const run = async (transcript) => { const r = await proposeFromTranscript({ transcript, chart: [] }, null, () => {}, { today: "2026-11-06" }); return r.proposal ?? r; };
  const triple = await run("Sondaje en el 4.6 de 5 5 6 por vestibular y 4 4 5 por lingual.");
  assert.deepEqual(triple.perio.map((p) => `${p.site}${p.depth}`), ["MV5", "V5", "DV6", "ML4", "L4", "DL5"]);
  const bare = await run("Periodontograma del 1.6: mesial vestibular 7, central 5, distal vestibular 6, todos con sangrado. Movilidad dos.");
  assert.deepEqual(bare.perio.map((p) => `${p.site}${p.depth}${p.bleeding ? "b" : ""}`), ["MV7b", "V5b", "DV6b"]);
  assert.equal(bare.mobility[0].tooth, 16);
  assert.equal(bare.mobility[0].grade, "II");
  const tail = await run("Sondaje en la pieza 2.6 mesio vestibular 6 mm, vestibular 4 mm, disto vestibular 5 mm, sangrado al sondaje en los tres sitios.");
  assert.ok(tail.perio.length === 3 && tail.perio.every((p) => p.bleeding));
});

test("sondaje dictado: «sangra en el distovestibular» marca solo ese sitio y una frase sin la palabra sondaje con varios sitios también cuenta", async () => {
  const { proposeFromTranscript } = await import("../lib/dictation/proposal.ts");
  const r = await proposeFromTranscript({ transcript: "Sondaje en el 3.6 de 5 5 6 por vestibular y 4 4 5 por lingual, sangra en el distovestibular. Pieza 1.6 mesial vestibular 7, central 5, distal vestibular 6, todos con sangrado.", chart: [] }, null, () => {}, { today: "2026-11-06" });
  const perio = (r.proposal ?? r).perio;
  assert.deepEqual(perio.filter((p) => p.tooth === 36 && p.bleeding).map((p) => p.site), ["DV"]);
  assert.equal(perio.filter((p) => p.tooth === 16 && p.bleeding).length, 3);
});

test("evolución del COP-D por fecha se reconstruye con los hitos de cada pieza", async () => {
  const { copEvolution } = await import("../app/odontogram-index.ts");
  const snap = (status, condition, missingReason = null) => ({ status, surfaces: condition ? { O: { condition, depth: null, icdas: null, activity: null } } : {}, missingReason, crown: null });
  const history = [
    { id: "a", tooth: 16, recordedAt: "2026-11-06T10:00:00Z", clinicalDate: "2026-08-03", eventType: "surface", after: snap("Sin hallazgos", "caries") },
    { id: "b", tooth: 16, recordedAt: "2026-11-06T10:01:00Z", clinicalDate: "2026-09-01", eventType: "surface", after: snap("Sin hallazgos", "restored") },
    { id: "c", tooth: 26, recordedAt: "2026-11-06T10:02:00Z", clinicalDate: "2026-09-01", eventType: "status", after: snap("Ausente", null, "caries") },
  ];
  const points = copEvolution([16, 26], history);
  assert.deepEqual(points.map((p) => [p.date, p.caries, p.missing, p.filled, p.total]), [["2026-08-03", 1, 0, 0, 1], ["2026-09-01", 0, 1, 1, 2]]);
});

test("simulación periodoncia/implantes: rectificación de cifras, cara primero, pieza heredada, sitio repetido e implantes en plural", async () => {
  const { proposeFromTranscript } = await import("../lib/dictation/proposal.ts");
  const run = async (transcript) => { const r = await proposeFromTranscript({ transcript, chart: [] }, null, () => {}, { today: "2026-11-06" }); return r.proposal ?? r; };
  const sites = (p) => p.perio.map((x) => `${x.tooth}${x.site}${x.depth}${x.bleeding ? "b" : ""}${x.suppuration ? "s" : ""}`);
  const fix = await run("Sondaje en la 1.7 mesial vestibular 5, perdón, 6 milímetros, vestibular 4, distal vestibular 5. Movilidad uno, no, movilidad dos.");
  assert.deepEqual(sites(fix), ["17MV6", "17V4", "17DV5"]);
  assert.equal(fix.mobility[0].grade, "II");
  const faceFirst = await run("Sondaje pieza 3 por vestibular 6 5 7, por palatino 4 4 5, sangra todo.");
  assert.deepEqual(sites(faceFirst), ["16MV6b", "16V5b", "16DV7b", "16ML4b", "16L4b", "16DL5b"]);
  const inherited = await run("Sondaje del 1.6, mesial vestibular 7, central 6, distal vestibular 8 con sangrado. Lingual 5 5 6.");
  assert.deepEqual(sites(inherited), ["16MV7", "16V6", "16DV8b", "16ML5", "16L5", "16DL6"]);
  const repeated = await run("En el 4.6 mesio vestibular 6 mm, vestibular 5 mm, disto vestibular 7 mm, supuración en el distal vestibular.");
  assert.deepEqual(sites(repeated), ["46MV6", "46V5", "46DV7s"]);
  const implants = await run("Cirugía: se instalan dos implantes en el 4.6 y en el 4.7.");
  assert.deepEqual(implants.odontogram.map((o) => `${o.tooth}:${o.status}`), ["46:Implante", "47:Implante"]);
});

test("corona cementada sobre una pieza que ya es implante queda como corona sobre implante; la impresión no coloca la corona; discrepancia IA/reglas en mm vale la regla", async () => {
  const { proposeFromTranscript } = await import("../lib/dictation/proposal.ts");
  const chart = [{ tooth: 36, status: "Implante" }, { tooth: 46, status: "Implante" }];
  const r = await proposeFromTranscript({ transcript: "Se cementa corona de zirconio en el 3.6 con cemento resinoso. Se toma impresión para corona sobre implante en el 4.6.", chart }, null, () => {}, { today: "2026-11-06" });
  const p = r.proposal ?? r;
  assert.deepEqual(p.odontogram.map((o) => [o.tooth, o.foundation]), [[36, "implant"]]);
});

test("«implante en el 4.6 con pilar» y «pilar protésico conectado» marcan implante con pilar", async () => {
  const { proposeFromTranscript } = await import("../lib/dictation/proposal.ts");
  const chart = [{ tooth: 46, status: "Implante" }];
  for (const transcript of ["Implante en el 4.6 con pilar, torque de treinta newton.", "Pilar protésico conectado en el 4.6 con torque de 30 newton."]) {
    const r = await proposeFromTranscript({ transcript, chart }, null, () => {}, { today: "2026-11-06" });
    assert.deepEqual((r.proposal ?? r).odontogram.map((o) => `${o.tooth}:${o.status}`), ["46:Implante con pilar"]);
  }
});

test("evolución mixta: corona en el 3.6 y pilar en el 4.6 se marcan cada uno en su pieza", async () => {
  const { proposeFromTranscript } = await import("../lib/dictation/proposal.ts");
  const chart = [{ tooth: 36, status: "Implante" }, { tooth: 46, status: "Implante" }];
  const r = await proposeFromTranscript({ transcript: "Se cementa corona de zirconio en el 3.6 con cemento resinoso. Implante en el 4.6 con pilar, torque de treinta newton. Se toma impresión para corona sobre implante en el 4.6.", chart }, null, () => {}, { today: "2026-11-06" });
  assert.deepEqual((r.proposal ?? r).odontogram.map((o) => `${o.tooth}:${o.status}`).sort(), ["36:Corona", "46:Implante con pilar"]);
});

test("presupuesto dictado en una frase aparte toma la prestación de la frase anterior", async () => {
  const { proposeFromTranscript } = await import("../lib/dictation/proposal.ts");
  const r = await proposeFromTranscript({ transcript: "Se planifica regeneración ósea guiada, presupuesto de trescientos cincuenta mil pesos.", chart: [] }, null, () => {}, { today: "2026-11-06" });
  assert.deepEqual((r.proposal ?? r).budget.map((b) => [b.label, b.amount]), [["Regeneración ósea guiada", 350000]]);
});

test("corona retirada o en preparación no se marca; pilar aflojado que se reaprieta no cambia el estado", async () => {
  const { proposeFromTranscript } = await import("../lib/dictation/proposal.ts");
  const run = async (transcript, chart) => { const r = await proposeFromTranscript({ transcript, chart }, null, () => {}, { today: "2026-11-06" }); return (r.proposal ?? r).odontogram.map((o) => `${o.tooth}:${o.status}`); };
  assert.deepEqual(await run("Fractura de corona de metal porcelana en el 1.1, se retira la corona y se hace perno muñón. Se prepara para corona nueva de disilicato color A dos.", [{ tooth: 11, status: "Corona" }]), []);
  assert.deepEqual(await run("Se cementa corona nueva de disilicato en el 1.1.", [{ tooth: 11, status: "Corona" }]), ["11:Corona"]);
  assert.deepEqual(await run("Descementación de corona del 2.6 con caries recurrente en el margen distal, se vuelve a cementar la corona. Implante del 1.6 con pilar aflojado, se reaprieta.", [{ tooth: 16, status: "Implante con pilar" }, { tooth: 26, status: "Corona" }]), ["26:Corona"]);
});

test("caries recurrente en el margen distal con obturación rehecha marca la cara D", async () => {
  const p = await quick("Pieza 4.6 caries recurrente en el margen distal, se rehace la obturación con resina compuesta.");
  assert.deepEqual(surfaces(p), [[46, "D", "restored"]]);
  const q = await quick("Pieza 1.6 caries recurrente por distal bajo la obturación antigua.");
  assert.deepEqual(surfaces(q), [[16, "D", "caries"]]);
});

test("furcación y clasificación periodontal dictadas se proponen para revisión", async () => {
  const p = await quick("Pieza 1.6 movilidad grado 1, furcación grado dos por vestibular. Periodontitis estadio 3 grado B generalizada.");
  assert.deepEqual(p.mobility.map((m) => [m.tooth, m.kind ?? "mov", m.grade]), [[16, "mov", "I"], [16, "furcacion", "II"]]);
  assert.deepEqual([p.perioClassification.stage, p.perioClassification.grade, p.perioClassification.extent], ["III", "B", "generalized"]);
  const q = await quick("Pieza 2.6 sondaje mesial 5 distal 6. Furcación grado 2.");
  assert.deepEqual(q.mobility.map((m) => [m.tooth, m.kind, m.grade]), [[26, "furcacion", "II"]]);
  const r = await quick("Pieza 3.6 movilidad grado 2.");
  assert.equal(r.perioClassification, undefined);
});

test("el examen dictado guarda furcación aparte de la movilidad", async () => {
  const { buildDictatedPerio } = await import("../lib/dictation/proposal.ts");
  const teeth = buildDictatedPerio([], [{ tooth: 16, grade: "I" }, { tooth: 16, grade: "II", kind: "furcacion" }]);
  assert.equal(teeth[16].mobility, "I");
  assert.equal(teeth[16].furcation, "II");
});
