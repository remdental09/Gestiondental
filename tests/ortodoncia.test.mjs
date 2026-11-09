import test from "node:test";
import assert from "node:assert/strict";
import { emptyOrtho, normalizeOrtho, referencedImageIds, summarizeOrtho, orthoActive, controlEvolutionText } from "../lib/orthodontics.ts";

test("normaliza: descarta fechas, ids y fotos inválidas", () => {
  const data = normalizeOrtho({
    diagnosis: { facial: { value: "Mesofacial", notes: "x".repeat(5000) }, inventado: { value: "no" } },
    plan: { startDate: "2026-02-30", estimatedMonths: 18, plannedControls: -4, appliances: ["Autoligado", "Autoligado", ""], nextControlDate: "2026-12-01" },
    controls: [{ id: "a", date: "2026-03-01", hygiene: "Buena" }, { id: "a", date: "2026-04-01" }, { id: "b", date: "mañana" }, { date: "2026-05-01" }],
    templates: [{ id: "t1", date: "2026-03-01", photos: { "f-reposo": 5, "otra": 9, "i-lat-d": -1 } }],
  });
  assert.equal(data.diagnosis.facial.notes.length, 2000);
  assert.equal("inventado" in data.diagnosis, false);
  assert.equal(data.plan.startDate, "");
  assert.equal(data.plan.plannedControls, 0);
  assert.deepEqual(data.plan.appliances, ["Autoligado"]);
  assert.equal(data.controls.length, 1);
  assert.deepEqual(data.templates[0].photos, { "f-reposo": 5 });
  assert.deepEqual(referencedImageIds(data), [5]);
});

test("entrada basura devuelve un documento vacío", () => {
  assert.deepEqual(normalizeOrtho(null), emptyOrtho());
  assert.deepEqual(normalizeOrtho("hola"), emptyOrtho());
  assert.equal(orthoActive(emptyOrtho()), false);
});

const plan = (over = {}, controls = []) => normalizeOrtho({ plan: { startDate: "2026-01-01", estimatedMonths: 12, plannedControls: 12, nextControlDate: "2026-11-20", ...over }, controls });

test("resumen: en tratamiento, atrasado, sin próximo control y finalizado", () => {
  assert.equal(summarizeOrtho(emptyOrtho(), "2026-11-09").status, "Sin plan");
  assert.equal(summarizeOrtho(plan(), "2026-11-09").status, "En tratamiento");
  const late = summarizeOrtho(plan({ nextControlDate: "2026-10-30" }), "2026-11-09");
  assert.equal(late.status, "Atrasado");
  assert.equal(late.daysLate, 10);
  assert.equal(summarizeOrtho(plan({ nextControlDate: "" }), "2026-11-09").status, "Sin próximo control");
  assert.equal(summarizeOrtho(plan(), "2026-11-09", true).status, "Finalizado");
});

test("resumen: avance de controles frente al tiempo y desfase", () => {
  const controls = Array.from({ length: 3 }, (_, i) => ({ id: `c${i}`, date: `2026-0${i + 2}-01` }));
  const s = summarizeOrtho(plan({}, controls), "2026-07-01");
  assert.equal(s.controlsDone, 3);
  assert.equal(s.controlsPercent, 25);
  assert.equal(s.expectedEnd, "2027-01-01");
  assert.equal(s.elapsedMonths, 5);
  assert.ok(s.timePercent >= 49 && s.timePercent <= 51);
  assert.equal(s.behindSchedule, true);
  assert.equal(summarizeOrtho(plan({}, controls), "2026-03-15").behindSchedule, false);
});

test("evolución de un control", () => {
  const text = controlEvolutionText({ id: "x", date: "2026-11-09", upperArch: "0.016 NiTi", lowerArch: "Sin arco", aligner: "", elastics: "Clase II", hygiene: "Regular", notes: "Se activa." }, "2026-12-10");
  assert.equal(text, "Control de ortodoncia: arco superior 0.016 NiTi; elásticos Clase II.\nHigiene: regular.\nSe activa.\nPróximo control: 10-12-2026.");
  assert.match(controlEvolutionText({ id: "y", date: "2026-11-09", upperArch: "", lowerArch: "", aligner: "", elastics: "", hygiene: "", notes: "" }), /sin cambios de aparatología/);
});
