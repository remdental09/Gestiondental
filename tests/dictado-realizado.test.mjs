import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { looksPerformed, sameTreatment, settlePerformed, mergeOperations, restoredSurfacesFrom } from '../lib/tooth-performed.ts';
import { toothPrompt, toothSpeechPrompt } from '../lib/dictation/tooth-prompts.ts';
import { redraftToothAnswer } from '../lib/dictation/tooth-answer-redraft.ts';

const src = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const today = '2026-11-22';
const item = (label, over = {}) => ({ label, amount: 0, phase: 'Fase 1', teeth: [34], ...over });

test('detecta cuando lo dictado como plan ya se hizo', () => {
  for (const text of ['Se realizará hoy una obturación oclusal de composite', 'hice una obturación oclusal', 'Se realizó la obturación', 'Obturé la oclusal con resina', 'se colocó una corona']) assert.ok(looksPerformed(text), text);
  for (const text of ['Se propondrá una obturación oclusal', 'Evaluar endodoncia si hay compromiso pulpar', 'Plan: corona de zirconio']) assert.ok(!looksPerformed(text), text);
});

test('misma prestación: por código de catálogo o por palabras clave', () => {
  assert.ok(sameTreatment({ label: 'Se propondrá realizar una obturación oclusal de composite en la pieza 28.', code: '5005017' }, { label: 'Obturación oclusal de composite', code: '5005017' }));
  assert.ok(sameTreatment({ label: 'Obturación oclusal de composite' }, { label: 'Se realizará una obturación oclusal de composite' }));
  assert.ok(!sameTreatment({ label: 'Obturación oclusal de composite', code: '5005017' }, { label: 'Corona de zirconio', code: '5011018' }));
  assert.ok(!sameTreatment({ label: 'Corona de zirconio' }, { label: 'Obturación oclusal de composite' }));
});

test('lo realizado cierra la prestación pendiente de esa pieza en vez de duplicarla', () => {
  const budgets = [
    { id: 3229, items: [item('Se propondrá realizar una obturación oclusal de composite en la pieza 28.', { code: '5005017' })] },
    { id: 3228, items: [item('Extracción de la pieza 30', { teeth: [36], code: '5011018' })] },
  ];
  const result = settlePerformed(budgets, 34, [item('Obturación oclusal de composite', { code: '5005017' })], today);
  assert.equal(result.remaining.length, 0);
  assert.equal(result.updates.length, 1);
  assert.equal(result.updates[0].budgetId, 3229);
  assert.equal(result.updates[0].items[0].doneOn, today);
  assert.equal(result.closed.length, 1);
  assert.equal(budgets[0].items[0].doneOn, undefined, 'no muta lo recibido');
});

test('sin plan previo, la prestación queda creada y ya realizada; otras piezas y alternativas no se tocan', () => {
  const budgets = [
    { id: 1, items: [item('Obturación oclusal de composite', { teeth: [16] })] },
    { id: 2, items: [item('Obturación oclusal de composite')], isAlternative: true },
    { id: 3, items: [item('Obturación oclusal de composite', { doneOn: '2026-01-01' })] },
  ];
  const result = settlePerformed(budgets, 34, [item('Obturación oclusal de composite')], today);
  assert.equal(result.updates.length, 0);
  assert.equal(result.remaining.length, 1);
  assert.equal(result.remaining[0].doneOn, today);
  assert.equal(result.remaining[0].startedOn, today);
});

test('cada realizada cierra una sola pendiente (la más reciente)', () => {
  const budgets = [{ id: 10, items: [item('Obturación oclusal de composite', { code: 'A' })] }, { id: 11, items: [item('Obturación oclusal de composite', { code: 'A' })] }];
  const result = settlePerformed(budgets, 34, [item('Obturación oclusal de composite', { code: 'A' })], today);
  assert.deepEqual(result.updates.map(update => update.budgetId), [11]);
});

test('lo realizado gana sobre el diagnóstico en la misma cara; el diagnóstico escrito se conserva', () => {
  const diagnosis = [{ kind: 'surface', surface: 'O', finding: { condition: 'caries' } }, { kind: 'surface', surface: 'M', finding: { condition: 'caries' } }, { kind: 'diagnosis', title: 'Dx', detail: 'caries' }];
  const done = [{ kind: 'surface', surface: 'O', finding: { condition: 'restored' } }];
  const merged = mergeOperations(diagnosis, done);
  assert.deepEqual(merged.filter(op => op.kind === 'surface').map(op => `${op.surface}:${op.finding.condition}`), ['M:caries', 'O:restored']);
  assert.ok(merged.some(op => op.kind === 'diagnosis'));
});

test('respaldo determinista: obturación oclusal de composite → cara O con resina compuesta', () => {
  const [one] = restoredSurfacesFrom('Se realizó una obturación oclusal de composite');
  assert.equal(one.surface, 'O');
  assert.equal(one.finding.condition, 'restored');
  assert.equal(one.finding.restorationMaterial, 'Resina compuesta');
  assert.equal(one.finding.restorationStage, 'definitive');
  assert.deepEqual(restoredSurfacesFrom('obturación mesial y distal con vidrio ionómero').map(x => x.surface).sort(), ['D', 'M']);
  assert.equal(restoredSurfacesFrom('obturación con cavit en oclusal')[0].finding.restorationStage, 'provisional');
  assert.deepEqual(restoredSurfacesFrom('endodoncia unirradicular'), []);
  assert.deepEqual(restoredSurfacesFrom('obturación sin cara dictada'), []);
});

test('la segunda pregunta cambia según el modo', () => {
  assert.match(toothPrompt('done', 34), /¿Qué tratamiento realizaste hoy en la pieza FDI/);
  assert.match(toothSpeechPrompt('done', 34), /realizaste hoy/);
  assert.match(toothPrompt('plan', 34), /plan de tratamiento preliminar/);
});

test('la IA redacta lo realizado en pasado, no como plan', async () => {
  let system = '';
  const fetcher = async (_url, init) => { system = JSON.parse(init.body).messages[0].content; return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ text: 'Se realizó una obturación oclusal de composite.' }) } }] }) }; };
  const text = await redraftToothAnswer('se realizará hoy una obturación oclusal de composite', 'done', 34, 'k', { fetcher });
  assert.match(text, /^Se realizó/);
  assert.match(system, /procedimiento ya realizado/);
  assert.match(system, /YA se realizó hoy/);
  const asPlan = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ text: 'Se propondrá una obturación oclusal de composite.' }) } }] }) });
  await assert.rejects(() => redraftToothAnswer('obturación oclusal de composite', 'done', 34, 'k', { fetcher: asPlan }), /como un plan/);
});

test('pantalla y servidor: selector de modo, aviso, evolución sin «presuntivo» y cierre de prestación', () => {
  const ui = src('components/tooth-dictation.tsx');
  for (const id of ['tooth-mode-picker', 'mode-plan', 'mode-done', 'tooth-performed-hint', 'tooth-performed-switch']) assert.ok(ui.includes(id), id);
  assert.match(ui, /Procedimiento realizado · pieza chilena/);
  
  assert.match(ui, /mergeOperations\(selectedOperations\(false\), selectedOperations\(true\)\)/);
  const route = src('app/api/clinical/route.ts');
  assert.match(route, /input\.performed === true/);
  assert.match(route, /settlePerformed\(/);
  assert.match(route, /updatedBudgets: closedBudgets/);
  assert.match(src('app/api/dictation/tooth-answer/route.ts'), /step !== "done"/);
  assert.match(src('app/page.tsx'), /performed=false/);
});

test('el modo elegido se lee desde una referencia (el flujo por voz usa callbacks anteriores al nuevo dibujo)', () => {
  const ui = src('components/tooth-dictation.tsx');
  assert.match(ui, /const modeRef = useRef<DictationMode \| null>\(null\)/);
  assert.match(ui, /forceDone \|\| isDone\(\) \? "done" : "plan"/);
  assert.match(ui, /const performedNow = isDone\(\)/);
  assert.match(ui, /onApply\(tooth, operations, budgetTitle, finalItems, evolution, performedNow\)/);
  assert.ok(!/const second\b/.test(ui));
  assert.match(ui, /looksPerformed\(rawAnswerText\) \|\| looksPerformed\(currentText\)/);
  for (const id of ['tooth-mode-chip', 'tooth-mode-toggle']) assert.ok(ui.includes(id), id);
});

test('el botón «Dictar esta pieza» se abre en dos y el dictado parte con el modo elegido', () => {
  const ui = src('components/tooth-dictation.tsx');
  assert.match(ui, /onClick=\{\(\) => setChoosing\(true\)\} data-testid="dictate-selected-tooth"/);
  assert.match(ui, /data-testid="mode-plan"[^>]*onClick=\{\(\) => startGuidedEvaluation\("plan"\)\}/);
  assert.match(ui, /data-testid="mode-done"[^>]*onClick=\{\(\) => startGuidedEvaluation\("done"\)\}/);
  assert.match(ui, /modeRef\.current = next;\s*setMode\(next\);[\s\S]*?setOpen\(true\);\s*askStep\("diagnosis"\)/);
  assert.ok(!ui.includes('absolute inset-0 z-20'), 'sin selector dentro de la ventana');
});

test('una prestación realizada cierra el plan dictado en una sola línea que la incluye', () => {
  const pending = item('Se propondrá la eliminación de caries, seguida de una pulpectomía y trepanación.', { teeth: [37] });
  assert.ok(sameTreatment(pending, item('Se realizó pulpectomía de la pieza dentaria.', { teeth: [37] })));
  const result = settlePerformed([{ id: 3233, items: [pending] }], 37, [item('Se realizó pulpectomía de la pieza dentaria.', { teeth: [37] })], today);
  assert.equal(result.remaining.length, 0);
  assert.equal(result.updates[0].items[0].doneOn, today);
  assert.ok(!sameTreatment(pending, item('Corona de zirconio')));
  assert.ok(!sameTreatment(item('Obturación oclusal de composite'), item('Extracción de la pieza 30')));
});

test('el hito del diagnóstico dice «procedimiento realizado», no «plan preliminar»', async () => {
  const { toothDiagnosisOperation } = await import('../lib/dictation/tooth-mode.ts');
  const done = toothDiagnosisOperation('Caries profunda', 'Se realizó pulpectomía', true);
  assert.equal(done.title, 'Diagnóstico y procedimiento realizado');
  assert.match(done.detail, /Procedimiento realizado: Se realizó pulpectomía/);
  assert.ok(!/preliminar/.test(done.detail));
  assert.equal(toothDiagnosisOperation('Caries profunda', 'Se propondrá obturar').title, 'Diagnóstico / hipótesis y plan preliminar');
});

import { endoFromDictation, applyEndoDictation } from '../lib/tooth-performed.ts';
import { endoMarksByTooth, emptyEndo } from '../lib/endodontics.ts';

test('endodoncia dictada como realizada: detecta el procedimiento y no confunde con obturación de composite', () => {
  assert.equal(endoFromDictation('Pulpectomía y trepanación realizada')?.type, 'Pulpectomía');
  assert.equal(endoFromDictation('Pulpectomía')?.obturated, false);
  assert.equal(endoFromDictation('Se realizó obturación de conductos con gutapercha')?.obturated, true);
  assert.equal(endoFromDictation('Tratamiento de conducto terminado')?.obturated, true);
  assert.equal(endoFromDictation('Obturación oclusal de composite'), null);
  assert.equal(endoFromDictation('Evaluar endodoncia si hay compromiso pulpar'), null);
});

test('endodoncia realizada: abre caso en curso, lo continúa sin duplicar y lo obtura', () => {
  let n = 0; const id = () => `id${++n}`;
  const first = applyEndoDictation(emptyEndo(), 46, endoFromDictation('pulpectomía realizada'), '2026-11-22', id);
  assert.equal(first.cases.length, 1);
  assert.equal(endoMarksByTooth(first)[46], 'en curso');
  const again = applyEndoDictation(first, 46, endoFromDictation('pulpectomía realizada'), '2026-11-22', id);
  assert.equal(again.cases.length, 1);
  assert.equal(again.cases[0].sessions.length, 1);
  const done = applyEndoDictation(again, 46, endoFromDictation('obturación de conductos realizada'), '2026-12-05', id);
  assert.equal(done.cases.length, 1);
  assert.equal(done.cases[0].obturation.date, '2026-12-05');
  assert.equal(endoMarksByTooth(done)[46], 'obturado');
});

test('el dictado por pieza llama al endograma solo cuando es realizado', () => {
  const page = src('app/page.tsx');
  assert.match(page, /performed\?endoFromDictation/);
  assert.match(page, /applyEndoDictation\(base,tooth/);
});
