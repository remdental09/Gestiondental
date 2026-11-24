import test from "node:test";
import assert from "node:assert/strict";
import { proposeFromTranscript } from "../lib/dictation/proposal.ts";
import { resolveSpokenDate, isAppointmentText } from "../lib/dictation/spoken.ts";

// Textos sintéticos escritos como una ficha (con encabezados de sección). Ninguno es una evolución real.
const run = async (text) => (await proposeFromTranscript({ transcript: text, chart: [] }, null, () => {}, { today: "2026-11-24", sensitivity: "basic" })).proposal;

test("un encabezado de sección solo en su línea no es algo dictado: no crea «Otros dichos» ni avisos", async () => {
  const p = await run("Procedimientos realizados\nSe realiza tomografía computarizada de haz cónico. Se efectúa ajuste oclusal y se deja la pieza 2.7 sin oclusión.");
  assert.ok(!/Otros dichos/.test(p.evolution.body), p.evolution.body);
  assert.ok(!p.clarifications.some((c) => /Revisa que la evolución incluya/.test(c)), JSON.stringify(p.clarifications));
});

test("«se controla el plano superior» no es una cita; «control en un año» sí, con fecha", async () => {
  assert.equal(isAppointmentText("Se controla el plano superior y se realiza alivio."), false);
  assert.equal(isAppointmentText("Se controla el lunes 30 en la mañana."), true);
  const date = resolveSpokenDate("Se indica control en un año.", "2026-11-24");
  assert.equal(date?.date, "2027-11-24");
  const p = await run("Se cementa la corona en la pieza 2.5. Se controla el plano superior y se realiza alivio.");
  assert.ok(!p.clarifications.some((c) => /próxima cita/.test(c)), JSON.stringify(p.clarifications));
});

test("prótesis removible, brackets y prueba de maqueta sin pieza no llevan diagnóstico de caries ni de pérdida de dientes", async () => {
  for (const text of [
    "Se realiza entrega de prótesis tipo Valplast. Se indica no comer con la prótesis.",
    "Se realiza prueba de maqueta de prótesis fija plural y se efectúan ajustes de anatomía.",
  ]) {
    const p = await run(text);
    assert.deepEqual(p.diagnoses ?? [], [], `${text} -> ${JSON.stringify(p.diagnoses)}`);
  }
});

test("endodoncia con trepanación o medicación intraconducto: diagnóstico pulpar, no «trastornos de los dientes»", async () => {
  const p = await run("Se realiza trepanación endodóntica en la pieza 3.1. Se deja medicación intraconducto con hidróxido de calcio y se coloca algodón con vidrio ionómero.");
  const dx = (p.diagnoses ?? []).filter((d) => d.tooth === 31);
  assert.ok(dx.length >= 1 && dx.every((d) => d.code.startsWith("DA09")), JSON.stringify(dx));
  assert.ok(!p.clarifications.some((c) => /Falta la superficie/.test(c)), JSON.stringify(p.clarifications));
});

test("blanqueamiento intracoronario con tope cervical de vidrio ionómero no es una restauración ni una caries", async () => {
  const p = await run("Se realiza segunda sesión de blanqueamiento intracoronario en la pieza 4.3, con perborato de sodio, algodón y tope cervical de vidrio ionómero.");
  assert.deepEqual(p.diagnoses ?? [], [], JSON.stringify(p.diagnoses));
  assert.ok(!p.clarifications.some((c) => /Falta la superficie|\(restauración\)/.test(c)), JSON.stringify(p.clarifications));
});

test("«Z250» tras «resina Filtek» no duplica la marca, y un tramo repetido queda una vez", async () => {
  const p = await run("Se realiza restauración con resina Filtek resina Filtek Z250 color A3 en oclusal de la 4.6.");
  assert.ok(!/Filtek resina Filtek/i.test(p.corrected.text), p.corrected.text);
  const q = await run("Se restaura con resina Filtek Z250 color A3 en oclusal de la 4.6.");
  assert.equal((q.corrected.text.match(/Filtek/gi) ?? []).length, 1, q.corrected.text);
});

test("cierre de chimenea, alargamiento o muñón no son hallazgos de superficie: no preguntan la cara", async () => {
  for (const text of [
    "En la pieza 4.6 se efectúa cierre de la chimenea con composite Filtek P60.",
    "Se realiza algodón e ionómero de vidrio en la pieza 1.7.",
  ]) {
    const p = await run(text);
    assert.ok(!p.clarifications.some((c) => /Falta la (?:superficie|cara)/.test(c)), `${text} -> ${JSON.stringify(p.clarifications)}`);
  }
});

test("«para la próxima sesión se planifican…» es plan, no una cita ni un diagnóstico olvidado", async () => {
  const p = await run("Para la próxima sesión se planifican fotografías, destartraje y escaneo intraoral.");
  assert.ok(!p.clarifications.some((c) => /próxima cita|olvidado el diagnóstico/.test(c)), JSON.stringify(p.clarifications));
  assert.ok(/Plan de tratamiento/.test(p.evolution.body), p.evolution.body);
});

test("«control en 1 semana» (con cifra) se resuelve a fecha igual que «en una semana»", () => {
  assert.equal(resolveSpokenDate("Se cita a control en 1 semana.", "2026-11-24")?.date, "2026-12-01");
  assert.equal(resolveSpokenDate("Control en 1 mes.", "2026-11-24")?.date, "2026-12-24");
});

test("negaciones y sectores no piden una pieza: «el sellante no se realiza», «destartraje en el grupo V»", async () => {
  for (const text of ["El sellante no se realiza durante esta atención.", "Se realiza destartraje en el grupo V."]) {
    const p = await run(text);
    assert.ok(!p.clarifications.some((c) => /Falta una pieza identificable/.test(c)), `${text} -> ${JSON.stringify(p.clarifications)}`);
  }
});

test("retiro de amalgama, recementación y sellantes no son hallazgos de superficie: no preguntan la cara", async () => {
  for (const text of [
    "Se realiza retiro de amalgama en la pieza 3.6.",
    "Se recementa la restauración de la pieza 2.5 con RelyX U200 color A2.",
    "Se realiza higiene oral y aplicación de sellante en las piezas 1.6, 2.6, 3.6 y 4.6.",
  ]) {
    const p = await run(text);
    assert.ok(!p.clarifications.some((c) => /Falta la (?:superficie|cara)/.test(c)), `${text} -> ${JSON.stringify(p.clarifications)}`);
  }
});

test("una frase que solo lista los materiales de una restauración ya dicha no pide una pieza; un plan sin pieza tampoco", async () => {
  const p = await run("En las piezas 4.7 y 4.6 se realiza restauración de resina compuesta oclusal. Se utiliza Denticlean, capa híbrida, adhesivo Single Bond Universal y resina Filtek Z250.");
  assert.ok(!p.clarifications.some((c) => /Falta una pieza identificable/.test(c)), JSON.stringify(p.clarifications));
  const q = await run("Se planifica continuar con el control de los terceros molares hasta establecer la indicación de exodoncia.");
  assert.ok(!q.clarifications.some((c) => /Falta una pieza identificable/.test(c)), JSON.stringify(q.clarifications));
});

test("«en la próxima hora/cita» con un plan, y «en la próxima sesión» suelto, no preguntan el día", () => {
  assert.equal(isAppointmentText("Se planifica blanqueamiento en la próxima hora."), false);
  assert.equal(isAppointmentText("Se planifica instalar aparatología Roth en la próxima cita."), false);
  assert.equal(isAppointmentText("En la próxima sesión"), false);
  assert.equal(isAppointmentText("Próxima cita el lunes 30."), true);
  assert.equal(isAppointmentText("Se agenda control en 3 semanas."), true);
});

test("«19 coma 5» dictado como medida no se marca como cifra inventada", async () => {
  const p = await run("Endodoncia pieza 3.1 conducto único a 19 coma 5, referencia borde incisal, obturación con guta.");
  assert.ok(!(p.clarifications ?? []).some((q) => /19\.5/.test(q)), JSON.stringify(p.clarifications));
});
