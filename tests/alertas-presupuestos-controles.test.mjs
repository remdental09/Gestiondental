import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { budgetStatus, budgetCardSummary, normalizeValidityDays } from '../lib/budget-status.ts';
import { deriveMedicalAlerts, deriveAdminAlerts, normalizeAlertKind, normalizeAlertText } from '../lib/patient-alerts.ts';
import { emptyAnamnesis } from '../lib/anamnesis.ts';
import { parseControlFromText, controlBucket, controlMatches, addMonths, whatsappLink } from '../lib/next-control.ts';

const item = (doneOn, amount = 10000) => ({ label: 'Prestación', amount, ...(doneOn ? { doneOn } : {}) });

test('estado del presupuesto: sin iniciar, en tratamiento, terminado', () => {
  const today = '2026-11-19';
  assert.equal(budgetStatus({ items: [item(), item()], createdOn: '2026-11-01' }, today), 'sin-iniciar');
  assert.equal(budgetStatus({ items: [item('2026-11-10'), item()], createdOn: '2026-01-01' }, today), 'en-tratamiento');
  assert.equal(budgetStatus({ items: [item('2026-11-10'), item('2026-11-12')], createdOn: '2026-11-01' }, today), 'terminado');
});

test('estado del presupuesto: alta manual prevalece y expirado según vigencia', () => {
  const today = '2026-11-19';
  assert.equal(budgetStatus({ items: [item()], status: 'Alta', createdOn: '2026-11-01' }, today), 'alta');
  assert.equal(budgetStatus({ items: [item('2026-11-10')], status: 'Alta' }, today), 'alta');
  // 90 días por defecto: el 21 de agosto son exactamente 90 días (aún vigente); el 20, 91 días (expirado).
  assert.equal(budgetStatus({ items: [item()], createdOn: '2026-08-21' }, today), 'sin-iniciar');
  assert.equal(budgetStatus({ items: [item()], createdOn: '2026-08-20' }, today), 'expirado');
  assert.equal(budgetStatus({ items: [item()], createdOn: '2026-10-01' }, today, 30), 'expirado');
  // Con algo realizado nunca expira.
  assert.equal(budgetStatus({ items: [item('2025-01-01'), item()], createdOn: '2024-01-01' }, today), 'en-tratamiento');
  // Sin fecha conocida no se marca expirado.
  assert.equal(budgetStatus({ items: [item()] }, today), 'sin-iniciar');
  assert.equal(budgetStatus({ items: [], createdOn: '2026-11-01' }, today), 'sin-iniciar');
  assert.equal(normalizeValidityDays('abc'), 90);
  assert.equal(normalizeValidityDays(120), 120);
});

test('tarjeta del presupuesto: avance, total, abonado y saldo', () => {
  const summary = budgetCardSummary([item('2026-11-01', 20000), item(undefined, 30000)], 15000);
  assert.deepEqual({ done: summary.done, count: summary.count, total: summary.total, paid: summary.paid, balance: summary.balance, percent: summary.percent }, { done: 1, count: 2, total: 50000, paid: 15000, balance: 35000, percent: 50 });
  assert.equal(budgetCardSummary([item(undefined, 1000)], 5000).balance, 0);
});

test('alertas médicas derivadas de la anamnesis y de la ficha', () => {
  const a = { ...emptyAnamnesis(), allergies: 'Penicilina', anticoagulants: 'si', conditions: ['diabetes', 'hipertension'], pregnancy: 'embarazada', otherConditions: 'Usa marcapasos desde 2019', medications: 'Alendronato 70 mg semanal' };
  const texts = deriveMedicalAlerts({ anamnesis: a }).map(x => x.text);
  for (const expected of ['Alergia: Penicilina', 'Usa anticoagulantes / antiagregantes', 'Diabetes', 'Hipertensión arterial', 'Embarazo', 'Marcapasos', 'Bifosfonatos (riesgo de osteonecrosis)']) assert.ok(texts.includes(expected), `falta ${expected}: ${texts.join(' | ')}`);
  // Sin duplicar lo que viene de la anamnesis estructurada y del texto libre.
  assert.equal(texts.filter(t => /diabetes/i.test(t)).length, 1);
  const legacy = deriveMedicalAlerts({ allergies: 'Látex', history: 'Antecedente de endocarditis. Hipertenso en tratamiento. Toma aspirina.' }).map(x => x.text);
  assert.equal(legacy[0], 'Alergia: Látex');
  assert.deepEqual([...legacy].sort(), ['Alergia: Látex', 'Hipertensión arterial', 'Riesgo de endocarditis / prótesis valvular', 'Usa anticoagulantes / antiagregantes']);
});

test('alertas médicas: lo negado o vacío no genera alerta', () => {
  assert.deepEqual(deriveMedicalAlerts({ allergies: 'Sin registrar', history: 'Sin registrar' }), []);
  assert.deepEqual(deriveMedicalAlerts({ allergies: 'Niega alergias', history: 'Niega diabetes, no es hipertenso. Sin anticoagulantes.' }), []);
  assert.deepEqual(deriveMedicalAlerts({ anamnesis: { ...emptyAnamnesis(), allergies: 'No' } }), []);
});

test('alertas administrativas: saldo por prestaciones realizadas sin pagar', () => {
  const budgets = [{ id: 1, isAlternative: false, items: [item('2026-11-01', 40000), item(undefined, 60000)] }, { id: 2, isAlternative: true, items: [item('2026-11-01', 999999)] }];
  assert.deepEqual(deriveAdminAlerts(budgets, [{ budgetId: 1, amount: 10000 }]).map(x => x.text), ['Saldo pendiente $30.000 por prestaciones realizadas']);
  assert.deepEqual(deriveAdminAlerts(budgets, [{ budgetId: 1, amount: 40000 }]), []);
  assert.equal(normalizeAlertKind('medica'), 'medica');
  assert.equal(normalizeAlertKind('otra'), null);
  assert.equal(normalizeAlertText('  hola   mundo '), 'hola mundo');
});

test('próximo control: fechas dictadas', () => {
  const today = '2026-11-19';
  const due = text => parseControlFromText(text, today)?.dueOn ?? null;
  assert.equal(due('Se indica control en 6 meses.'), '2027-05-19');
  assert.equal(due('Citar en 2 semanas para retiro de puntos'), '2026-12-03');
  assert.equal(due('control en dos semanas'), '2026-12-03');
  assert.equal(due('Control en un año'), '2027-11-19');
  assert.equal(due('control el 15 de diciembre'), '2026-12-15');
  assert.equal(due('control el 10 de enero'), '2027-01-10');
  assert.equal(due('volver en 15 días'), '2026-12-04');
  assert.equal(due('Control al mes'), '2026-12-19');
  assert.equal(due('control en 6 meses más'), '2027-05-19');
  assert.equal(parseControlFromText('Citar en 2 semanas para retiro de puntos', today)?.reason, 'Control: retiro de puntos');
  assert.equal(parseControlFromText('control de implante en 3 meses', today)?.reason, 'Control de implante');
  // Sin palabra de control no se sugiere nada.
  assert.equal(parseControlFromText('Paciente con dolor hace 6 meses.', today), null);
  assert.equal(parseControlFromText('Se realiza obturación en 2.6', today), null);
  // Fin de mes: 31 de enero + 1 mes = 28 de febrero.
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(parseControlFromText('control en un mes', '2026-01-31')?.dueOn, '2026-02-28');
});

test('próximos controles: filtros vencidos / esta semana / este mes', () => {
  const today = '2026-11-19'; // jueves
  assert.equal(controlBucket('2026-11-18', today), 'vencido');
  assert.equal(controlBucket('2026-11-22', today), 'semana'); // domingo
  assert.equal(controlBucket('2026-11-23', today), 'mes');
  assert.equal(controlBucket('2026-12-01', today), 'despues');
  assert.equal(controlMatches('vencidos', { dueOn: '2026-11-01', status: 'pendiente' }, today), true);
  assert.equal(controlMatches('vencidos', { dueOn: '2026-11-01', status: 'realizado' }, today), false);
  assert.equal(controlMatches('mes', { dueOn: '2026-11-20', status: 'pendiente' }, today), true);
  assert.equal(controlMatches('todos', { dueOn: '2030-01-01', status: 'descartado' }, today), true);
  assert.match(whatsappLink('+56 9 1234 5678', 'Hola'), /^https:\/\/wa\.me\/56912345678\?text=Hola$/);
  assert.match(whatsappLink('912345678', 'x'), /wa\.me\/56912345678/);
  assert.equal(whatsappLink('123', 'x'), null);
});

test('integración: barra de alertas, tarjetas, controles y aislamiento por espacio', () => {
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /data-testid="sticky-allergies"/);
  assert.match(page, /<PatientAlertsBar patientId=\{patient\.id\}/);
  assert.match(page, /<BudgetCardsBoard budgets=\{patientBudgets\}/);
  assert.match(page, /section==="Controles"&&<NextControlsPanel/);
  assert.match(page, /<PatientNextControl patientId=\{patient\.id\}/);
  assert.match(page, /<ControlsHomeCard onOpen=/);
  const db = readFileSync(new URL('../app/followup-db.ts', import.meta.url), 'utf8');
  for (const sql of db.match(/"(SELECT|UPDATE|DELETE)[^"]*"|`(SELECT|UPDATE|DELETE)[^`]*`/g)) assert.match(sql, /owner_id = \?/, sql);
  assert.doesNotMatch(db, /DROP |ALTER /);
  for (const route of ['alertas', 'controles', 'preferencias']) {
    const src = readFileSync(new URL(`../app/api/${route}/route.ts`, import.meta.url), 'utf8');
    assert.match(src, /getChatGPTUser/);
    assert.match(src, /sameOrigin\(request\)/);
  }
  const dictation = readFileSync(new URL('../components/clinical-dictation.tsx', import.meta.url), 'utf8');
  assert.match(dictation, /setControlItem\(control \? \{ \.\.\.control, note: "", decision: "rejected" \} : null\)/);
  const clinical = readFileSync(new URL('../app/api/clinical/route.ts', import.meta.url), 'utf8');
  assert.match(clinical, /action === "setBudgetStatus"[\s\S]{0,600}budgetAccess\(ownerId, budgetId\)/);
});
