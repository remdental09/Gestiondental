import test from "node:test";
import assert from "node:assert/strict";
import { classifyEvolution } from "../lib/dictation/evolution-type.ts";
import { nameVariantOf, checkPatientMentions, patientVariantNote } from "../lib/dictation/patient-check.ts";
import { proposeFromTranscript } from "../lib/dictation/proposal.ts";
import { stripDictationFrame } from "../lib/dictation/spoken.ts";

test("tipo de evolución: controles, procedimientos e implantes", () => {
  const type = (text) => classifyEvolution(text, null).type;
  assert.equal(type("Control de implante pieza 3.6, estable, sin dolor."), "implante-control");
  assert.equal(type("Se instala implante en 4.6, torque 35 Ncm."), "implante-instalacion");
  assert.equal(type("Se instala pilar de cicatrización en implante 4.6."), "implante-rehabilitacion");
  assert.equal(type("Se cementa corona sobre implante 3.6."), "implante-rehabilitacion");
  assert.equal(type("Se realiza obturación de resina en oclusal de la 3.6."), "obturacion");
  assert.equal(type("Se realiza profilaxis y destartraje, pulido coronario."), "higiene");
  assert.equal(type("Control de ortodoncia, se cambia arco."), "ortodoncia");
  assert.equal(type("Paciente en control, sin hallazgos nuevos. Control en 6 meses."), "control");
  assert.equal(type("Urgencia por dolor agudo en 2.6."), "urgencia");
  assert.equal(classifyEvolution("Control de implante", "FDI 3.6").title, "Control de implante · FDI 3.6");
  // La próxima cita no convierte un procedimiento en control.
  assert.equal(type("Se realiza obturación oclusal de la 3.6. Control en 6 meses."), "obturacion");
});

test("nombre oído mal: variante plausible vs otra persona", () => {
  assert.equal(nameVariantOf("Camila Fuentes Araya", "Camila Fuentes Araya"), "same");
  assert.equal(nameVariantOf("Camila Fuente Saraya", "Camila Fuentes Araya"), "variant");
  assert.equal(nameVariantOf("Camila Pérez", "Camila Fuentes Araya"), "different");
  assert.equal(nameVariantOf("Juan Soto", "Camila Fuentes Araya"), "different");
  const text = "Hola, quiero evolucionar la ficha de Camila Fuente Saraya, control de implante 3.6 estable.";
  const check = checkPatientMentions(text, { name: "Camila Fuentes Araya" });
  assert.equal(check.mismatches.length, 0);
  assert.equal(patientVariantNote(check, "Camila Fuentes Araya").length, 1);
});

test("se quita el preámbulo y el cierre dictados", () => {
  const frame = stripDictationFrame("Hola, quiero evolucionar la ficha de Camila Fuentes Araya. Control estable. Eso es todo lo que quiero evolucionar.");
  assert.doesNotMatch(frame.text, /evolucionar|Hola/i);
  assert.match(frame.text, /Control estable/);
});

test("sin cupo de IA (4006): control de implante ya registrado no toca el odontograma", async () => {
  const failing = { id: "x", model: "m", complete: async () => { throw new Error("4006: you have used up your daily free allocation"); } };
  const text = "Hola y quiero evolucionar la ficha de Camila Fuente Saraya la paciente tiene Controlamos una semana es después el implante de la pieza: 30 con un pilar de 2 mm continuar estable la percusión se mantiene estable sin dolor el implante en la mesa: eso es todo lo que quiero evolucionar ahora Se controla en tres semanas";
  const outcome = await proposeFromTranscript({ transcript: text, chart: [{ tooth: 36, status: "Implante" }] }, failing, () => {}, { today: "2026-11-01" });
  const p = outcome.proposal;
  assert.equal(outcome.engine, "reglas-locales");
  assert.equal(p.evolutionKind.type, "implante-control");
  assert.deepEqual(p.odontogram, []);
  assert.deepEqual(p.appointments.map((a) => a.day), ["2026-11-22"]);
  assert.ok(p.clarifications.some((q) => /en la mesa/i.test(q)));
  // «pieza 30» es chilena (FDI 3.6): ya tiene implante y no se pregunta.
  assert.equal(p.clarifications.some((q) => /pieza 30/.test(q)), false);
  assert.match(p.evolution.title, /FDI 3\.6/);
  assert.doesNotMatch(p.evolution.body, /evolucionar|Hola/);
});
