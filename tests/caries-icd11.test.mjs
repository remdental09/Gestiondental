import test from 'node:test';
import assert from 'node:assert/strict';
import { cariesDepthFrom, cariesDetail } from '../lib/caries.ts';
import { cariesIcd11, icd11FromText, icd11Label, ICD11 } from '../lib/icd11.ts';
import { answerLines, finalizeEvolution, structureTranscript, textDiagnoses, tidyClarifications } from '../lib/dictation/proposal.ts';

test('profundidad de caries: formas habladas', () => {
  assert.equal(cariesDepthFrom('caries de esmalte').depth, 'esmalte');
  assert.equal(cariesDepthFrom('caries en dentina superficial').depth, 'dentina_superficial');
  assert.equal(cariesDepthFrom('caries de dentina profunda').depth, 'dentina_profunda');
  assert.equal(cariesDepthFrom('caries profunda').depth, 'dentina_profunda');
  assert.equal(cariesDepthFrom('caries penetrante').depth, 'pulpar');
  assert.equal(cariesDepthFrom('caries con compromiso pulpar').depth, 'pulpar');
  const dentina = cariesDepthFrom('caries de dentina');
  assert.equal(dentina.depth, null);
  assert.match(dentina.ambiguous ?? '', /superficial o profunda/);
  assert.equal(cariesDepthFrom('caries mesial').depth, null);
});

test('códigos CIE-11 de la caries según profundidad (DA08.0 con poscoordinación de sitio)', () => {
  assert.deepEqual(cariesIcd11(null), { code: 'DA08.0', title: 'Caries dental' });
  assert.equal(cariesIcd11('esmalte').code, 'DA08.0&XA5R09');
  assert.equal(cariesIcd11('dentina_superficial').code, 'DA08.0&XA6FX3');
  assert.equal(cariesIcd11('dentina_profunda').code, 'DA08.0&XA6FX3');
  assert.equal(cariesIcd11('pulpar').code, 'DA08.0&XA5B71');
  assert.equal(icd11Label(cariesIcd11('dentina_profunda')), 'CIE-11 DA08.0&XA6FX3 Caries dental · Dentina');
  for (const entry of Object.values(ICD11)) assert.match(entry.id, /^\d+$/, entry.code);
});

test('registros anteriores con ICDAS se siguen mostrando', () => {
  assert.match(cariesDetail({ condition: 'caries', icdas: 3, activity: 'active' }), /ICDAS 3 \(registro anterior\).*activa/);
  assert.match(cariesDetail({ condition: 'caries', depth: 'esmalte' }), /esmalte/i);
  assert.match(cariesDetail({ condition: 'caries' }), /profundidad sin registrar/);
});

test('diagnósticos del texto con CIE-11: sin relatos, negaciones ni sospechas', () => {
  assert.deepEqual(icd11FromText('pulpitis irreversible').map((e) => e.code), ['DA09.0']);
  assert.deepEqual(icd11FromText('absceso periapical con fístula').map((e) => e.code), ['DA09.61']);
  const dx = textDiagnoses('Pieza 2.6 con pulpitis irreversible. Sin signos de periodontitis apical. No se confirma diagnóstico de necrosis pulpar. Probable absceso periapical. El paciente dice que tiene gingivitis.');
  assert.deepEqual(dx.map((d) => [d.tooth, d.code]), [[26, 'DA09.0']]);
  assert.equal(dx[0].label, 'FDI 2.6: Pulpitis (CIE-11 DA09.0)');
});

test('la caries de la muestra queda con profundidad y CIE-11, sin preguntar', () => {
  const p = structureTranscript('pieza dos cuatro caries mesial oclusal de dentina profunda');
  assert.deepEqual(p.odontogram.map((i) => [i.tooth, i.surface, i.finding.depth]).sort(), [[24, 'M', 'dentina_profunda'], [24, 'O', 'dentina_profunda']]);
  assert.equal(p.clarifications.length, 0, p.clarifications.join('\n'));
  assert.match(p.evolution.body, /FDI 2\.4 \(Chile 12\): caries de dentina profunda M-O \(CIE-11 DA08\.0&XA6FX3 Caries dental · Dentina\)\./);
});

test('la aclaración de profundidad completa la caries y la pregunta desaparece', () => {
  const first = structureTranscript('pieza 30 caries distal');
  assert.equal(first.clarifications.filter((q) => /profundidad de la caries/.test(q)).length, 1);
  const lines = answerLines([{ question: first.clarifications[0], answer: 'penetrante' }]);
  assert.deepEqual(lines, ['Aclaración: pieza 30 caries distal: penetrante.']);
  const p = structureTranscript(`pieza 30 caries distal. ${lines.join(' ')}`);
  assert.deepEqual(p.odontogram.map((i) => [i.tooth, i.surface, i.finding.depth]), [[36, 'D', 'pulpar']]);
  assert.equal(p.clarifications.some((q) => /profundidad de la caries/.test(q)), false);
});

test('preguntas repetidas de IA y reglas se juntan', () => {
  const odontogram = [{ kind: 'surface', tooth: 36, surface: 'D', finding: { condition: 'caries', depth: null } }];
  const notes = [
    'FDI 3.6: ¿profundidad de la caries (esmalte, dentina superficial, dentina profunda o compromiso pulpar)? Opcional: «pieza 30 caries distal».',
    'IA: FDI 3.6: ¿profundidad de la caries (esmalte, dentina superficial, dentina profunda o compromiso pulpar)? Opcional: «caries distal».',
    '¿Con qué medio se pagaron $50.000?',
    'IA: ¿Con qué medio se pagaron $50.000?',
  ];
  assert.equal(tidyClarifications(notes, odontogram).length, 2);
  const answered = [{ ...odontogram[0], finding: { condition: 'caries', depth: 'esmalte' } }];
  assert.equal(tidyClarifications(notes, answered).length, 1);
});

test('al guardar no se reescribe una nota editada si no se pasan diagnósticos', () => {
  const edited = 'Examen\nTexto editado por el profesional.';
  const body = finalizeEvolution(edited, [], '');
  assert.equal(body.includes('Diagnósticos (CIE-11)'), false);
});
