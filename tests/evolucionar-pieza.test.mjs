import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evolveSteps, evolveProblem, evolveSummary } from '../lib/tooth-evolve.ts';

const src = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const today = '2026-11-22';

test('obturación: un guardado por cara, con material, etapa y fecha elegida', () => {
  const steps = evolveSteps(34, { kind: 'obturacion', surfaces: ['O', 'D'], material: 'Cavit' }, '2026-11-10', 'Cavit hasta la rehabilitación');
  assert.equal(steps.length, 2);
  assert.deepEqual(steps.map(s => s.surface), ['O', 'D']);
  assert.equal(steps[0].action, 'setToothSurface');
  assert.equal(steps[0].clinicalDate, '2026-11-10');
  assert.equal(steps[0].finding.condition, 'restored');
  assert.equal(steps[0].finding.restorationStage, 'provisional');
  assert.match(steps[0].historyTitle, /^Obturación en Oclusal/);
  assert.equal(steps[0].historyDetail, 'Cavit hasta la rehabilitación');
  assert.equal(evolveSteps(34, { kind: 'obturacion', surfaces: ['O'], material: 'Resina compuesta' }, today, '')[0].finding.restorationStage, 'definitive');
});

test('corona: estado Corona y luego el material, sobre diente natural', () => {
  const steps = evolveSteps(34, { kind: 'corona', material: 'Zirconio' }, today, '');
  assert.deepEqual(steps.map(s => s.action), ['setToothStatus', 'setCrownDetails']);
  assert.equal(steps[0].status, 'Corona');
  assert.equal(steps[1].foundation, 'tooth');
  assert.ok(steps.every(s => s.clinicalDate === today));
});

test('implante: con corona agrega el material sobre implante; sin corona, un solo paso', () => {
  assert.equal(evolveSteps(34, { kind: 'implante', status: 'Implante' }, today, '').length, 1);
  const withCrown = evolveSteps(34, { kind: 'implante', status: 'Implante', crownMaterial: 'Disilicato' }, today, '');
  assert.equal(withCrown[1].foundation, 'implant');
});

test('extracción: pieza ausente y causa solo si se conoce', () => {
  assert.deepEqual(evolveSteps(34, { kind: 'extraccion', reason: 'unknown' }, today, '').map(s => s.action), ['setToothStatus']);
  const withReason = evolveSteps(34, { kind: 'extraccion', reason: 'caries' }, today, '');
  assert.deepEqual(withReason.map(s => s.action), ['setToothStatus', 'setToothMissingReason']);
  assert.equal(withReason[0].status, 'Ausente');
});

test('lesión y nota', () => {
  assert.equal(evolveSteps(34, { kind: 'lesion', status: 'Granuloma apical' }, today, '')[0].status, 'Granuloma apical');
  const note = evolveSteps(34, { kind: 'nota' }, today, '  Control sin dolor  ');
  assert.deepEqual([note[0].action, note[0].text], ['addToothNote', 'Control sin dolor']);
});

test('validación del formulario', () => {
  assert.equal(evolveProblem({ kind: 'corona', material: 'Zirconio' }, '', today, today), null);
  assert.match(evolveProblem({ kind: 'corona', material: 'Zirconio' }, '', '2026-12-01', today), /futura/);
  assert.match(evolveProblem({ kind: 'corona', material: 'Zirconio' }, '', '', today), /fecha/);
  assert.match(evolveProblem({ kind: 'obturacion', surfaces: [], material: 'Resina compuesta' }, '', today, today), /cara/);
  assert.match(evolveProblem({ kind: 'nota' }, '  ', today, today), /Escribe/);
  assert.match(evolveSummary(34, { kind: 'corona', material: 'Zirconio' }, '2026-11-10'), /10-11-2026/);
});

test('servidor y pantalla: fecha manual validada, nota de pieza y botón en la película', () => {
  const route = src('app/api/clinical/route.ts');
  assert.match(route, /action === "addToothNote"/);
  assert.match(route, /Revisa la fecha: no puede ser futura/);
  assert.match(route, /manualTitle \|\| fallbackTitle/);
  assert.match(src('components/odontogram.tsx'), /<ToothEvolve key=\{selected\}/);
  assert.match(src('components/odontogram.tsx'), /onEvolveTooth\?:/);
  assert.match(src('app/page.tsx'), /onEvolveTooth=\{chartDate\?undefined:evolveTooth\}/);
  const ui = src('components/tooth-evolve.tsx');
  for (const id of ['evolve-open', 'evolve-dialog', 'evolve-kind', 'evolve-date', 'evolve-note', 'evolve-save']) assert.ok(ui.includes(id), id);
  assert.match(src('components/tooth-story.tsx'), /actions\?: ReactNode/);
});
