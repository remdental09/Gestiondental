import test from "node:test";
import assert from "node:assert/strict";
import { proposeFromTranscript } from "../lib/dictation/proposal.ts";
import { evidencePlaces, parseActs } from "../lib/dictation/clinical-acts.ts";

// Caso sintético basado en un error real de comprensión (sin datos del paciente):
// «se retira la amalgama … se coloca vidrio ionómero para inactivar la caries» se cobraba como obturación de amalgama.
const DICTADO = "Pieza 1.6 caras mesial y oclusal: se retira la amalgama fracturada y se elimina la caries. Se coloca vidrio ionómero en dos porciones para inactivar la caries de dentina superficial. Se realiza destartraje subgingival en el sextante uno.";
const salidaIA = (actos) => ({
  nota: {
    examen: "",
    procedimientos: "En la pieza 1.6 se retira la amalgama fracturada y se elimina la caries. Se coloca vidrio ionómero en dos porciones para inactivar la caries de dentina superficial. Se realiza destartraje subgingival en el sextante uno.",
  },
  // La IA se equivoca en el hallazgo y en el código (así ocurrió): obturación M-O y amalgama compuesta.
  hallazgos: [{ pieza: "1.6", sistema: "FDI", tipo: "superficie", condicion: "obturacion", estado: "", caras: ["M", "O"], profundidad: "", material: "amalgama", color: "", evidencia: "Pieza 1.6 caras mesial y oclusal: se retira la amalgama fracturada y se elimina la caries" }],
  procedimientos: [
    { texto: "Se retira la amalgama fracturada de la pieza 1.6 y se obtura", evidencia: "se retira la amalgama fracturada y se elimina la caries", codigo: "5005002" },
    { texto: "Inactivación de caries con vidrio ionómero en la pieza 1.6", evidencia: "Se coloca vidrio ionómero en dos porciones para inactivar la caries", codigo: "5010029" },
    { texto: "Destartraje subgingival sextante uno", evidencia: "Se realiza destartraje subgingival en el sextante uno", codigo: "5009013" },
  ],
  presupuesto: [], ficha: [], periodonto: [], pagos: [], citas: [], diagnosticos: [], diagnosticos_sugeridos: [], dudas: [], texto_corregido: "",
  actos,
});
const ACTO_INACTIVACION = { pieza: "1.6", sistema: "FDI", caras: ["M", "O"], accion: "inactivar_caries", material_colocado: "ionomero", material_retirado: "amalgama", intencion: "inactivacion", estado_final_cara: "caries", evidencia: "se retira la amalgama fracturada y se elimina la caries. Se coloca vidrio ionómero en dos porciones para inactivar la caries" };
const propose = (actos) => proposeFromTranscript({ transcript: DICTADO, chart: [] }, { id: "t", model: "t", complete: async () => salidaIA(actos) }, () => {});

test("con actos comprendidos: no se cobra amalgama, se cobra inactivación, y la 1.6 queda con caries (no obturada)", async () => {
  const { proposal } = await propose([ACTO_INACTIVACION]);
  const codes = (proposal.prestaciones ?? []).map((item) => item.code);
  assert.ok(!codes.includes("5005002"), `no debe cobrar amalgama: ${codes}`);
  assert.ok(!codes.includes("5005004"), `no debe cobrar obturación de ionómero aparte: ${codes}`);
  assert.ok(codes.includes("5010029"), `debe cobrar inactivación: ${codes}`);
  const faces = proposal.odontogram.filter((item) => item.tooth === 16 && item.kind === "surface");
  assert.ok(faces.length > 0);
  assert.ok(faces.every((item) => item.finding?.condition === "caries"), JSON.stringify(faces.map((item) => item.finding)));
  assert.doesNotMatch(proposal.evolution?.body ?? "", /obturaci[oó]n M-O/i);
});

test("la IA no puede decir que colocó un material que la cita dice que se retiró", () => {
  assert.equal(evidencePlaces("se retira la amalgama fracturada", "amalgama"), false);
  assert.equal(evidencePlaces("se obtura con amalgama en oclusal", "amalgama"), true);
  assert.equal(evidencePlaces("se retira la amalgama y se coloca vidrio ionómero", "ionomero"), true);
  const rejected = [];
  const acts = parseActs([{ ...ACTO_INACTIVACION, material_colocado: "amalgama", evidencia: "se retira la amalgama fracturada" }], () => true, () => ({ ok: true, tooth: 16 }), (m) => rejected.push(m));
  assert.equal(acts[0].placed, "");
  assert.equal(rejected.length, 1);
});

test("un acto sin cita literal del dictado no se usa", () => {
  const rejected = [];
  const acts = parseActs([{ ...ACTO_INACTIVACION, evidencia: "algo que no se dijo" }], () => false, () => ({ ok: true, tooth: 16 }), (m) => rejected.push(m));
  assert.equal(acts.length, 0);
  assert.equal(rejected.length, 1);
});

test("obturación con resina tras retirar amalgama: se cobra resina compuesta (no amalgama) y la cara queda obturada con resina", async () => {
  const dictado = "Pieza 4.6 caras oclusal y distal: se retira la amalgama filtrada y se obtura con resina compuesta.";
  const salida = {
    nota: { examen: "", procedimientos: "En la pieza 4.6 se retira la amalgama filtrada y se obtura con resina compuesta en oclusal y distal." },
    hallazgos: [{ pieza: "4.6", sistema: "FDI", tipo: "superficie", condicion: "obturacion", estado: "", caras: ["O", "D"], profundidad: "", material: "", color: "", evidencia: "Pieza 4.6 caras oclusal y distal: se retira la amalgama filtrada y se obtura con resina compuesta" }],
    procedimientos: [{ texto: "Obturación en pieza 4.6", evidencia: "se retira la amalgama filtrada y se obtura con resina compuesta", codigo: "5005002" }],
    presupuesto: [], ficha: [], periodonto: [], pagos: [], citas: [], diagnosticos: [], diagnosticos_sugeridos: [], dudas: [], texto_corregido: "",
    actos: [{ pieza: "4.6", sistema: "FDI", caras: ["O", "D"], accion: "obturar", material_colocado: "resina", material_retirado: "amalgama", intencion: "definitiva", estado_final_cara: "obturada", evidencia: "se retira la amalgama filtrada y se obtura con resina compuesta" }],
  };
  const { proposal } = await proposeFromTranscript({ transcript: dictado, chart: [] }, { id: "t", model: "t", complete: async () => salida }, () => {});
  const codes = (proposal.prestaciones ?? []).map((item) => item.code);
  assert.ok(!codes.includes("5005002"), `no debe cobrar amalgama: ${codes}`);
  assert.ok(codes.includes("5005018"), `debe cobrar resina compuesta posterior 2 caras: ${codes}`);
  const faces = proposal.odontogram.filter((item) => item.tooth === 46 && item.kind === "surface");
  assert.ok(faces.length > 0 && faces.every((item) => item.finding?.condition === "restored" && item.finding?.restorationMaterial === "Resina compuesta"), JSON.stringify(faces.map((f) => f.finding)));
});

test("el revisor de coherencia ve nota, prestaciones y actos, y su objeción deja la prestación desmarcada con motivo", async () => {
  let seen = "";
  const review = async (_system, payload) => { seen = payload; return JSON.stringify({ observaciones: [], prestaciones: [{ codigo: "5009013", motivo: "Se dictaron dos sextantes y se cobra uno." }], nota: [{ motivo: "La nota usa numeración chilena y el odontograma FDI." }] }); };
  const { proposal } = await proposeFromTranscript({ transcript: DICTADO, chart: [] }, { id: "t", model: "t", complete: async () => salidaIA([ACTO_INACTIVACION]), review }, () => {});
  const payload = JSON.parse(seen);
  assert.ok(payload.nota_propuesta.length > 0);
  assert.ok(payload.prestaciones_propuestas.some((item) => item.codigo === "5010029"));
  assert.equal(payload.actos_comprendidos[0].accion, "inactivar_caries");
  assert.equal(payload.actos_comprendidos[0].pieza, "1.6");
  const objected = (proposal.prestaciones ?? []).find((item) => item.code === "5009013");
  assert.match(objected?.advisory ?? "", /dos sextantes/);
  assert.ok(proposal.clarifications.some((item) => /nota: La nota usa numeración chilena/.test(item)));
});

test("una objeción a un código que no está en la propuesta se ignora", async () => {
  const review = async () => JSON.stringify({ observaciones: [], prestaciones: [{ codigo: "5999999", motivo: "Código inventado por el revisor." }], nota: [] });
  const { proposal } = await proposeFromTranscript({ transcript: DICTADO, chart: [] }, { id: "t", model: "t", complete: async () => salidaIA([ACTO_INACTIVACION]), review }, () => {});
  assert.ok((proposal.prestaciones ?? []).every((item) => !item.advisory));
});

// Escenarios de la revisión independiente: la comprensión es por pieza y por cara, nunca por sesión.
const run = (dictado, salida) => proposeFromTranscript({ transcript: dictado, chart: [] }, { id: "t", model: "t", complete: async () => ({ presupuesto: [], ficha: [], periodonto: [], pagos: [], citas: [], diagnosticos: [], diagnosticos_sugeridos: [], dudas: [], texto_corregido: "", hallazgos: [], ...salida }) }, () => {});
const keys = (proposal) => (proposal.prestaciones ?? []).filter((item) => !item.advisory).map((item) => `${item.code}@${item.tooth}`);

test("la pieza del acto se resuelve aunque la cita cruce dos frases sin nombrarla", async () => {
  const { proposal } = await propose([ACTO_INACTIVACION]);
  assert.equal(proposal.acts?.[0]?.tooth, 16);
});

test("dos piezas: inactivación en la 1.6 y amalgama en la 2.6 → no se cobra amalgama en la 1.6", async () => {
  const dictado = "Pieza 1.6 caras mesial y oclusal: se retira la amalgama fracturada y se coloca vidrio ionómero para inactivar la caries. Pieza 2.6 oclusal: se obtura con amalgama.";
  const { proposal } = await run(dictado, {
    nota: { procedimientos: "En la pieza 1.6 se retira la amalgama fracturada y se coloca vidrio ionómero para inactivar la caries. En la pieza 2.6 se obtura con amalgama en oclusal." },
    procedimientos: [
      { texto: "Obturación de amalgama compuesta en la pieza 1.6", evidencia: "Pieza 1.6 caras mesial y oclusal: se retira la amalgama fracturada", codigo: "5005002" },
      { texto: "Obturación de amalgama simple en la pieza 2.6", evidencia: "Pieza 2.6 oclusal: se obtura con amalgama", codigo: "5005001" },
    ],
    actos: [
      { pieza: "1.6", sistema: "FDI", caras: ["M", "O"], accion: "inactivar_caries", material_colocado: "ionomero", material_retirado: "amalgama", intencion: "inactivacion", estado_final_cara: "caries", evidencia: "Pieza 1.6 caras mesial y oclusal: se retira la amalgama fracturada y se coloca vidrio ionómero para inactivar la caries" },
      { pieza: "2.6", sistema: "FDI", caras: ["O"], accion: "obturar", material_colocado: "amalgama", material_retirado: "", intencion: "definitiva", estado_final_cara: "obturada", evidencia: "Pieza 2.6 oclusal: se obtura con amalgama" },
    ],
  });
  const got = keys(proposal);
  assert.ok(!got.includes("5005002@16"), `no debe cobrar amalgama en 1.6: ${got}`);
  assert.ok(got.includes("5010029@16"), `inactivación en 1.6: ${got}`);
  assert.ok(got.includes("5005001@26"), `amalgama simple en 2.6: ${got}`);
});

test("misma pieza, caras distintas: inactivación en mesial y resina en distal → la distal queda obturada con resina", async () => {
  const dictado = "En la pieza 1.6 por mesial se coloca vidrio ionómero para inactivar la caries. En la pieza 1.6 por distal se obtura con resina compuesta.";
  const { proposal } = await run(dictado, {
    nota: { procedimientos: dictado },
    hallazgos: [{ pieza: "1.6", sistema: "FDI", tipo: "superficie", condicion: "obturacion", estado: "", caras: ["D"], profundidad: "", material: "resina", color: "", evidencia: "En la pieza 1.6 por distal se obtura con resina compuesta" }],
    procedimientos: [],
    actos: [
      { pieza: "1.6", sistema: "FDI", caras: [], accion: "inactivar_caries", material_colocado: "ionomero", material_retirado: "", intencion: "inactivacion", estado_final_cara: "caries", evidencia: "En la pieza 1.6 por mesial se coloca vidrio ionómero para inactivar la caries" },
      { pieza: "1.6", sistema: "FDI", caras: ["D"], accion: "obturar", material_colocado: "resina", material_retirado: "", intencion: "definitiva", estado_final_cara: "obturada", evidencia: "En la pieza 1.6 por distal se obtura con resina compuesta" },
    ],
  });
  const distal = proposal.odontogram.find((item) => item.tooth === 16 && item.surface === "D");
  assert.equal(distal?.finding?.condition, "restored", JSON.stringify(distal?.finding));
  assert.equal(distal?.finding?.restorationMaterial, "Resina compuesta");
  assert.ok(keys(proposal).includes("5005017@16"), `resina simple en 1.6: ${keys(proposal)}`);
});

test("«se reemplaza por amalgama nueva» cuenta como amalgama colocada", () => {
  assert.equal(evidencePlaces("se retira la amalgama antigua y se reemplaza por amalgama nueva", "amalgama"), true);
});

test("la inactivación codificada por la IA sin pieza no se cobra dos veces cuando el acto la ubica en la pieza", async () => {
  const dictado = "En la pieza 1.6 se coloca vidrio ionómero para inactivar la caries.";
  const { proposal } = await run(dictado, {
    nota: { procedimientos: dictado },
    procedimientos: [{ texto: "Inactivación de caries con vidrio ionómero", evidencia: "se coloca vidrio ionómero para inactivar la caries", codigo: "5010029" }],
    actos: [{ pieza: "1.6", sistema: "FDI", caras: [], accion: "inactivar_caries", material_colocado: "ionomero", material_retirado: "", intencion: "inactivacion", estado_final_cara: "caries", evidencia: "En la pieza 1.6 se coloca vidrio ionómero para inactivar la caries" }],
  });
  assert.deepEqual(keys(proposal).filter((key) => key.startsWith("5010029")), ["5010029@16"]);
});
