import test from "node:test";
import assert from "node:assert/strict";
import { chartConsistencyDoubts, proposeFromTranscript, structureTranscript } from "../lib/dictation/proposal.ts";

const transcript = "Se realiza tratamiento de conductos en la 3.6, molar inferior vital, con conductometría y obturación de conductos. Se instala corona metal cerámica en la 1.5. Se aplican sellantes en 1.6 y 2.6. Se realiza exodoncia simple de la 4.8.";
const empty = { nota: { motivo: "", anamnesis: "", examen: "", diagnostico: "", procedimientos: "Se realiza tratamiento de conductos en la pieza 3.6. Se instala corona metal cerámica en la pieza 1.5. Se realiza exodoncia simple de la pieza 4.8.", plan: "", indicaciones: "", presupuesto: "" }, hallazgos: [], procedimientos: [], presupuesto: [], ficha: [], texto_corregido: transcript, periodonto: [], pagos: [], citas: [], diagnosticos: [], dudas: [] };
// El modelo solo ve la corona; la exodoncia la detectan las reglas.
const model = (output) => ({ id: "test", model: "test", complete: async () => output });
const crownOnly = { ...empty, hallazgos: [{ pieza: "1.5", sistema: "FDI", tipo: "estado", condicion: "", estado: "Corona", caras: [], profundidad: "", material: "Metal cerámica", color: "", evidencia: "Se instala corona metal cerámica en la 1.5" }] };

test("una exodoncia dictada como realizada queda propuesta como Ausente aunque la IA no la nombre", async () => {
  const out = await proposeFromTranscript({ transcript, chart: [{ tooth: 48, status: "Indicación de exodoncia" }] }, model(crownOnly), () => {}, { today: "2026-11-06" });
  const proposal = out.proposal ?? out;
  const extraction = proposal.odontogram.find((item) => item.tooth === 48);
  assert.equal(extraction?.status, "Ausente");
  assert.equal(extraction?.advisory, undefined, "una exodoncia explícita no debe quedar sin aceptar");
});

test("una pieza que solo vieron las reglas sigue pidiendo revisión si no es una exodoncia explícita", async () => {
  const out = await proposeFromTranscript({ transcript: "Pieza 3.7 ausente. Se instala corona metal cerámica en la 1.5.", chart: [] }, model({ ...crownOnly, texto_corregido: "Pieza 3.7 ausente. Se instala corona metal cerámica en la 1.5." }), () => {}, { today: "2026-11-06" });
  const proposal = out.proposal ?? out;
  assert.ok(proposal.odontogram.find((item) => item.tooth === 37)?.advisory);
});

test("«obturación de conductos» no genera «falta la superficie»", () => {
  const proposal = structureTranscript("Se realiza tratamiento de conductos en la 3.6 con obturación de conductos.", { today: "2026-11-06" });
  assert.equal(proposal.clarifications.some((note) => /Falta la superficie/.test(note)), false);
  assert.equal(proposal.odontogram.length, 0);
});

test("avisa cuando se dicta un tratamiento sobre un implante o una pieza ausente de la ficha", () => {
  const chart = [{ tooth: 36, status: "Implante" }, { tooth: 26, status: "Ausente" }, { tooth: 15, status: "Corona" }];
  const doubts = chartConsistencyDoubts(transcript, chart);
  assert.equal(doubts.length, 2);
  assert.match(doubts.join("\n"), /FDI 3\.6 figura como implante/);
  assert.match(doubts.join("\n"), /FDI 2\.6 figura como ausente/);
});

test("no avisa si lo dictado ya dice implante o ausente, ni si la pieza no está en conflicto", () => {
  const chart = [{ tooth: 36, status: "Implante" }, { tooth: 26, status: "Ausente" }];
  assert.deepEqual(chartConsistencyDoubts("Se instala corona sobre implante en la 3.6. La 2.6 sigue ausente.", chart), []);
  assert.deepEqual(chartConsistencyDoubts("Se realiza exodoncia simple de la 4.8.", chart), []);
  assert.deepEqual(chartConsistencyDoubts("Se realiza exodoncia simple de la 4.8.", []), []);
});

test("«molar inferior vital» descrito por el modelo no se guarda como Diagnóstico", async () => {
  const tx = "Se realiza tratamiento de conductos en la 3.6, molar inferior vital, con conductometría y obturación de conductos.";
  const out = await proposeFromTranscript({ transcript: tx, chart: [] }, model({ ...empty, texto_corregido: tx, nota: { ...empty.nota, diagnostico: "Molar inferior vital en la pieza 3.6.", procedimientos: "Se realiza tratamiento de conductos en la pieza 3.6." } }), () => {}, { today: "2026-11-06" });
  const proposal = out.proposal ?? out;
  assert.doesNotMatch(proposal.note ?? JSON.stringify(proposal), /Diagnóstico\s*\n?[^\n]*vital/i);
});
