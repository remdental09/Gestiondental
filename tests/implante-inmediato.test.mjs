import test from "node:test";
import assert from "node:assert/strict";
import { proposeFromTranscript } from "../lib/dictation/proposal.ts";

// Dictado de cirugía de implante inmediato (paciente ficticio). La voz oyó «velo» y «un» donde iba «alvéolo» y «la 8».
const TEXT = "Cirugía de implante en la pieza 8. Se realiza la extracción de una raíz dental en la pieza 8. Procedemos a instalar en el alvéolo fresco la pieza un implante de 3,3 milímetros de ancho por 8 milímetros de largo de marca FGM Arcsys. Se coloca injerto de hidroxiapatita por vestibular. Se realiza una carga inmediata con un muñón de la misma marca de 4 milímetros de altura y una manga de 2 milímetros de altura.";

const finding = (estado, evidencia) => ({ pieza: "8", sistema: "chilena", tipo: "estado", condicion: "", estado, caras: [], profundidad: "", material: "", color: "", evidencia });
const nota = { motivo: "Cirugía de implante en la pieza 8.", anamnesis: "", alergias: "", medicamentos: "", examen: "", diagnostico: "", procedimientos: "Extracción de raíz dental. Instalación de implante.", plan: "", indicaciones: "", presupuesto: "" };
const base = { nota, hallazgos: [], procedimientos: [], presupuesto: [], ficha: [], texto_corregido: TEXT, periodonto: [], pagos: [], citas: [], diagnosticos: [], diagnosticos_sugeridos: [], dudas: [] };
const model = (hallazgos) => ({ id: "x", model: "x", complete: async () => ({ usedModel: "x", output: { ...base, hallazgos } }) });
const states = (proposal) => proposal.odontogram.map((item) => `${item.tooth}:${item.status}${item.conflict ? ":conflicto" : ""}${item.advisory ? ":aviso" : ""}`);

test("reglas: extracción + implante en la misma pieza queda solo como Implante, y «la pieza un implante» no es la pieza 1", async () => {
  const { proposal } = await proposeFromTranscript({ transcript: TEXT, chart: [] }, null, () => {}, { today: "2026-11-07" });
  assert.deepEqual(states(proposal), ["11:Implante"]);
  assert.ok(!proposal.odontogram.some((item) => item.tooth === 18), "FDI 1.8 no se tocó");
});

test("la voz dijo «velo»: el implante igual queda en la pieza 8, sin pieza 1", async () => {
  const heard = TEXT.replace("alvéolo", "velo");
  const { proposal } = await proposeFromTranscript({ transcript: heard, chart: [] }, null, () => {}, { today: "2026-11-07" });
  assert.deepEqual(states(proposal), ["11:Implante"]);
});

test("IA + reglas: el implante de la 8 queda sin conflicto y listo para aceptar", async () => {
  const ai = model([
    finding("Ausente", "Se realiza la extracción de una raíz dental en la pieza 8"),
    finding("Implante", "Procedemos a instalar en el alvéolo fresco la pieza un implante de 3,3 milímetros"),
  ]);
  const { proposal } = await proposeFromTranscript({ transcript: TEXT, chart: [] }, ai, () => {}, { today: "2026-11-07" });
  assert.deepEqual(states(proposal), ["11:Implante"]);
  assert.ok(!proposal.clarifications.some((q) => /incompatibles|no coinciden/.test(q)));
});

test("sin implante, una extracción sigue dejando la pieza Ausente", async () => {
  const { proposal } = await proposeFromTranscript({ transcript: "Se realiza la extracción de la pieza 8 por fractura radicular.", chart: [] }, null, () => {}, { today: "2026-11-07" });
  assert.ok(states(proposal).includes("11:Ausente"));
});

test("«pieza uno» sí es la pieza 1 chilena (FDI 1.8)", async () => {
  const { proposal } = await proposeFromTranscript({ transcript: "Se realiza la extracción de la pieza uno.", chart: [] }, null, () => {}, { today: "2026-11-07" });
  assert.ok(states(proposal).includes("18:Ausente"));
});
