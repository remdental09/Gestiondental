import test from 'node:test';
import assert from 'node:assert/strict';
import { cementedCrownFromEvolution } from '../app/crown-evidence.ts';
import { installedImplantTeeth } from '../app/implant-evidence.ts';
import { projectEvolutionChart, projectionHolds } from '../app/odontogram-projection.ts';

const empty = { teeth: {}, surfaces: {}, missingReason: {}, crowns: {} };

function project(body, source = empty) {
  return projectEvolutionChart(source, installedImplantTeeth(body), cementedCrownFromEvolution(body));
}

test('una corona sola se proyecta como corona y la verificación no la exige como implante', () => {
  const note = 'Se cementó corona de zirconio color A2 en pieza 12.';
  assert.deepEqual(installedImplantTeeth(note), []);
  const projected = project(note);
  assert.equal(projected.data.teeth[24], 'Corona');
  assert.equal(projected.data.crowns[24].foundation, 'tooth');
  assert.equal(projected.data.crowns[24].material, 'Zirconio');
  assert.equal(Object.values(projected.data.teeth).includes('Implante'), false);
  assert.equal(projectionHolds(projected.data, projected.expectations), true);
  assert.equal(projectionHolds(projected.data, [{ tooth: 24, status: 'Implante', crownFoundation: null }]), false);
});

test('un implante solo no crea corona', () => {
  const projected = project('Se instaló un implante en la pieza 30.');
  assert.equal(projected.data.teeth[36], 'Implante');
  assert.equal(projected.data.crowns[36], undefined);
  assert.equal(projectionHolds(projected.data, projected.expectations), true);
});

test('corona sobre implante conserva implante y prótesis', () => {
  const note = 'Se cementó corona de zirconio sobre implante en pieza 19.';
  const projected = project(note);
  assert.equal(projected.data.teeth[46], 'Implante');
  assert.equal(projected.data.teeth[46] === 'Corona', false);
  assert.equal(projected.data.crowns[46].foundation, 'implant');
  assert.equal(projected.data.crowns[46].material, 'Zirconio');
  assert.equal(projectionHolds(projected.data, projected.expectations), true);
});

test('reafirmar el implante no borra la corona que ya está sobre él', () => {
  const source = {
    teeth: { 36: 'Implante' },
    surfaces: {},
    missingReason: {},
    crowns: { 36: { material: 'Zirconio', foundation: 'implant' } },
  };
  const projected = project('Se instaló un implante en la pieza 30.', source);
  assert.equal(projected.data.teeth[36], 'Implante');
  assert.equal(projected.data.crowns[36].foundation, 'implant');
  assert.equal(projected.data.crowns[36].material, 'Zirconio');
});

test('una corona sobre diente natural no reemplaza un implante ya registrado', () => {
  const source = { teeth: { 36: 'Implante' }, surfaces: {}, missingReason: {}, crowns: {} };
  const projected = projectEvolutionChart(source, [], cementedCrownFromEvolution('Se cementó corona de zirconio en pieza 30.'));
  assert.equal(projected.data.teeth[36], 'Implante');
  assert.equal(projected.updatedTeeth.length, 0);
  assert.equal(projected.data.crowns[36], undefined);
});
