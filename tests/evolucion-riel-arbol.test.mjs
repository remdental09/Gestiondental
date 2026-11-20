import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { budgetTree, branchOf } from '../lib/budget-tree.ts';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('árbol: ramas por pieza, sextante y boca con progreso y cartola del presupuesto', () => {
  const tree = budgetTree({ id: 1, title: 'Plan', items: [
    { label: 'Resina 2.7', amount: 40000, teeth: [27], doneOn: '2026-11-01' },
    { label: 'Corona 2.7', amount: 300000, status: 'iniciada' },
    { label: 'Destartraje subgingival', amount: 20000, zone: 'perm:sext-1', doneOn: '2026-11-02' },
    { label: 'Higiene', amount: 10000 },
  ] }, 30000);
  assert.deepEqual(tree.branches.map(b => [b.label, `${b.done}/${b.total}`]), [['Pieza 2.7', '1/2'], ['Sextante 1', '1/1'], ['Boca / sesión', '0/1']]);
  assert.equal(tree.total, 370000);
  assert.equal(tree.doneValue, 60000);
  assert.equal(tree.owedForDone, 30000, 'realizado no pagado');
  assert.equal(tree.saldo, 340000);
  assert.equal(tree.started, 1);
});

test('rama: zona boca y piezas múltiples', () => {
  assert.equal(branchOf({ label: 'Profilaxis', amount: 1, zone: 'perm:boca' }).label, 'Boca completa');
  assert.equal(branchOf({ label: 'Puente', amount: 1, teeth: [14, 15, 16] }).label, 'Piezas 1.4, 1.5, 1.6');
});

test('riel vertical junto a cada evolución con las 8 acciones; el árbol vive en la pestaña Evolución', () => {
  const rail = read('components/evolution-rail.tsx');
  for (const label of ['Dictar', 'Presup.', 'Realizado', 'Cobrar', 'Control', 'Cita', 'WhatsApp', 'Receta']) assert.ok(rail.includes(`"${label}"`), label);
  assert.match(rail, /sticky/);
  const page = read('app/page.tsx');
  assert.match(page, /<BudgetTree /);
  assert.match(page, /rail=\{\(note,latest\)=>/);
  assert.match(page, /action:"setBudgetItemStatus"/);
  assert.match(read('components/clinical-dictation.tsx'), /gd-open-dictation/);
  const history = read('components/evolution-history.tsx');
  assert.match(history, /rail\(note, note\.id === latestId\)/);
});
