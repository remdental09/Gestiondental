import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evolutionTeeth, evolutionDiagnosis, evolutionItems, pendingItems, draftItemFor, teethLabel } from "../lib/evolution-rail.ts";
import { buildAppUrl, parseAppUrl } from "../lib/app-url.ts";

const note = { title: "Exodoncia · FDI 2.8", body: "Diagnóstico: pericoronaritis pieza 2.8.\nPlan: exodoncia.", diagnoses: [] };

test("piezas de la evolución: título, diagnósticos y «pieza 28» escrito", () => {
  assert.deepEqual(evolutionTeeth(note), [28]);
  assert.deepEqual(evolutionTeeth({ title: "Control", body: "Se revisa pieza 28 y pieza 3.8", diagnoses: [{ title: "Caries", tooth: 16 }] }), [16, 28, 38]);
  assert.deepEqual(evolutionTeeth({ title: "Control", body: "Presión 120/80, 12 mm", diagnoses: [] }), []);
  assert.equal(teethLabel([28]), "pieza 2.8");
  assert.equal(teethLabel([16, 28]), "piezas 1.6, 2.8");
});

test("diagnóstico para la receta: codificado o la línea «Diagnóstico:»", () => {
  assert.equal(evolutionDiagnosis(note), "pericoronaritis pieza 2.8.");
  assert.equal(evolutionDiagnosis({ ...note, diagnoses: [{ title: "Pericoronaritis aguda", tooth: 28 }] }), "Pericoronaritis aguda (pieza 2.8)");
  assert.equal(evolutionDiagnosis({ title: "x", body: "sin diagnóstico", diagnoses: [] }), "");
});

test("prestaciones de la pieza en los presupuestos abiertos; Realizado solo marca las pendientes", () => {
  const budgets = [{ id: 7, title: "Plan", items: [{ label: "Exodoncia simple 2.8", amount: 45000 }, { label: "Destartraje", amount: 30000 }, { label: "Control", amount: 0, teeth: [28], doneOn: "2026-11-19" }] }];
  const items = evolutionItems(budgets, [28]);
  assert.deepEqual(items.map(i => [i.budgetId, i.index, i.status]), [[7, 0, "pendiente"], [7, 2, "terminada"]]);
  assert.deepEqual(pendingItems(items).map(i => i.index), [0]);
  assert.deepEqual(evolutionItems(budgets, []), []);
  assert.deepEqual(draftItemFor(note, [28]), { label: "Exodoncia", amount: 0, phase: "Fase 1", discountPercent: 0, teeth: [28] });
});

test("Documentación tiene URL propia (Atrás de Safari vuelve a la ficha)", () => {
  assert.equal(buildAppUrl({ section: "Documentación", patientId: 2, tab: "evoluciones" }), "/?seccion=documentos");
  assert.equal(parseAppUrl("?seccion=documentos").section, "Documentación");
  assert.equal(buildAppUrl({ section: "Controles", patientId: 2, tab: "evoluciones" }), "/?seccion=controles");
});

test("cada botón del riel abre su sección real con el paciente elegido", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const rail = page.slice(page.indexOf("rail={(note,latest)=>"), page.indexOf("below={note=>"));
  assert.match(rail, /onDocument:\(kind\)=>.*setDocStart\(\{patientId:patient\.id,kind,.*navigateTo\("Documentación"/);
  assert.match(rail, /onBudget:.*navigateTo\("Ficha clínica",patient\.id,"presupuestos"\).*startNewBudgetWith\(draftItemFor/);
  assert.match(rail, /onCharge:.*navigateTo\("Ficha clínica",patient\.id,"presupuestos"\).*openManualPayment\(target/);
  assert.match(rail, /onControl:.*setControlStart\(\{patientId:patient\.id.*navigateTo\("Controles"/);
  assert.match(rail, /onAppointment:.*navigateTo\("Agenda".*openNewApptFor\(patient/);
  assert.match(rail, /onMarkDone:.*markEvolutionDone\(pending/);
  assert.match(rail, /whatsappHref:wa\?`https:\/\/wa\.me\/\$\{wa\}`/);
  assert.match(page, /<DocumentationPanel key=\{docStart\?\.nonce\?\?0\} start=\{docStart\}/);
  assert.match(page, /<ControlsSection key=\{controlStart\?\.nonce\?\?0\} start=\{controlStart\}/);
  assert.match(page, /data-testid="rail-notice"/);
});
