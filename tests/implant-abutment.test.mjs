import test from 'node:test';
import assert from 'node:assert/strict';
import { projectEvolutionChart } from '../app/odontogram-projection.ts';
import { planChartWrites, proposeFromTranscript, TOOTH_STATUSES } from '../lib/dictation/proposal.ts';
import { classifyEvolution } from '../lib/dictation/evolution-type.ts';

const chart = (teeth, crowns = {}) => ({ teeth, surfaces: {}, missingReason: {}, crowns });
const propose = async (transcript, current = []) => (await proposeFromTranscript({ transcript, chart: current }, null)).proposal;

test('«Implante con pilar» es un estado del odontograma distinto de implante y de implante con corona', () => {
  assert.ok(TOOTH_STATUSES.includes('Implante con pilar'));
  assert.ok(TOOTH_STATUSES.includes('Implante'));
});

test('pilar instalado sobre una pieza marcada como implante propone «Implante con pilar» marcado', async () => {
  const proposal = await propose('Se instala pilar protésico en implante 3.6, torque 30 Ncm.', [{ tooth: 36, status: 'Implante' }]);
  const item = proposal.odontogram.find((entry) => entry.tooth === 36);
  assert.equal(item.status, 'Implante con pilar');
  assert.equal(item.advisory, undefined);
  assert.match(proposal.evolution.body, /FDI 3\.6.*implante con pilar/);
});

test('pilar en una pieza que no figura como implante queda propuesto sin marcar', async () => {
  const proposal = await propose('Se conectó pilar en implante 2.6.');
  const item = proposal.odontogram.find((entry) => entry.tooth === 26);
  assert.equal(item.status, 'Implante con pilar');
  assert.match(item.advisory, /no muestra implante en FDI 2\.6/);
});

test('un control que menciona el pilar no cambia el estado', async () => {
  for (const status of ['Implante', 'Implante con pilar']) {
    const proposal = await propose('Control de implante 3.6 con pilar de 2 mm, estable.', [{ tooth: 36, status }]);
    assert.deepEqual(proposal.odontogram, []);
    assert.equal(proposal.evolutionKind.type, 'implante-control');
  }
});

test('pilar de cicatrización queda en la evolución, no como «Implante con pilar»', async () => {
  const proposal = await propose('Se instala pilar de cicatrización en implante 3.6.', [{ tooth: 36, status: 'Implante' }]);
  assert.equal(proposal.odontogram.some((entry) => entry.status === 'Implante con pilar'), false);
});

test('corona sobre un implante con pilar lo deja como implante con corona', async () => {
  const proposal = await propose('Se cementa corona de zirconio sobre implante 3.6.', [{ tooth: 36, status: 'Implante con pilar' }]);
  assert.deepEqual(proposal.odontogram.map((entry) => [entry.kind, entry.foundation]), [['crown', 'implant']]);
  const actions = planChartWrites(5, chart({ 36: 'Implante con pilar' }), chart({ 36: 'Implante con pilar' }), proposal.odontogram);
  assert.deepEqual(actions.map((a) => [a.action, a.status ?? a.foundation]), [['setToothStatus', 'Implante'], ['setCrownDetails', 'implant']]);
});

test('el guardado de «Implante con pilar» escribe ese estado y no registra superficies', () => {
  const accepted = [{ id: 'x', tooth: 36, numbering: 'FDI', numberingLabel: 'FDI 3.6', sourceText: '', kind: 'status', status: 'Implante con pilar' },
    { id: 'y', tooth: 36, numbering: 'FDI', numberingLabel: 'FDI 3.6', sourceText: '', kind: 'surface', surface: 'O', finding: { condition: 'caries', depth: 'esmalte' } }];
  const actions = planChartWrites(5, chart({ 36: 'Implante' }), chart({ 36: 'Implante' }), accepted);
  assert.deepEqual(actions, [{ action: 'setToothStatus', patientId: 5, tooth: 36, status: 'Implante con pilar' }]);
});

test('la proyección antigua de evoluciones no devuelve un implante con pilar a «Implante»', () => {
  const projected = projectEvolutionChart(chart({ 36: 'Implante con pilar' }), [36], null);
  assert.equal(projected.data.teeth[36], 'Implante con pilar');
  assert.deepEqual(projected.updatedTeeth, []);
});

test('«se conecta pilar» sin decir implante cuenta como trabajo sobre implante solo si la pieza ya es implante', () => {
  assert.equal(classifyEvolution('Se conecta pilar en la pieza 3.6.', null, true).type, 'implante-rehabilitacion');
  assert.notEqual(classifyEvolution('Se conecta pilar en la pieza 3.6.', null, false).type, 'implante-rehabilitacion');
});
