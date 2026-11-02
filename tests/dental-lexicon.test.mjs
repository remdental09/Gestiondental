import test from 'node:test';
import assert from 'node:assert/strict';
import { correctDentalTerms, dentalGlossaryFor, dentalGlossaryLine, isDentalWord, lexiconStats, nearestDentalWord, phoneticKey } from '../lib/dictation/dental-lexicon.ts';
import { applyLexicon, judgeCorrection, reconcileCorrection } from '../lib/dictation/spoken.ts';
import { correctionSystemPrompt, correctWithOpenAi } from '../lib/dictation/openai-correction.ts';
import { proposeFromTranscript, validateAiExtraction } from '../lib/dictation/proposal.ts';

const REAL = 'se evalúa el paciente hoy día y estamos confirmo que necesita esta traje supergival completo así que el día de hoy se va a realizar traje los seis grupos dentales más un Pulido coronario es la actividad por hoy el presupuesto será de $90,000 para los 6ectontes';

test('el léxico dental es grande y cubre las áreas pedidas', () => {
  const stats = lexiconStats();
  assert.ok(stats.terms >= 1500, `términos: ${stats.terms}`);
  assert.ok(stats.wordForms >= 2500);
  for (const word of ['destartraje', 'supragingival', 'subgingival', 'sextante', 'pulpotomía', 'gingivectomía', 'periimplantitis', 'articaína', 'clorhexidina', 'retroalveolar', 'brackets', 'fonasa', 'isapre', 'presupuesto', 'abono', 'atrición']) {
    assert.ok(isDentalWord(word), word);
  }
});

test('la clave fonética iguala b/v, s/c/z, j/g y h muda', () => {
  assert.equal(phoneticKey('albeolar'), phoneticKey('alveolar'));
  assert.equal(phoneticKey('subjingival'), phoneticKey('subgingival'));
  assert.equal(phoneticKey('ipoclorito'), phoneticKey('hipoclorito'));
  assert.equal(nearestDentalWord('supragingibal')?.written, 'supragingival');
});

test('caso real: destartraje supragingival, sextantes y monto chileno', () => {
  const { text, corrections } = applyLexicon(REAL);
  assert.match(text, /necesita esta destartraje supragingival completo/);
  assert.match(text, /realizar destartraje los seis sextantes más un Pulido coronario/);
  assert.match(text, /\$90\.000 para los 6 sextantes$/);
  assert.ok(corrections.every((c) => c.origin === 'diccionario' && c.applied));
  assert.ok(corrections.some((c) => /destartraje/.test(c.corrected)));
});

test('corrige términos dentales mal oídos', () => {
  const cases = [
    ['se realiza destar traje sub gingival', 'se realiza destartraje subgingival'],
    ['se hace pulpo tomia', 'se hace pulpotomía'],
    ['endo doncia de la 2.6', 'endodoncia de la 2.6'],
    ['radiografia retro albeolar', 'radiografia retroalveolar'],
    ['anestesia con articaina tecnica de espix', 'anestesia con articaína tecnica de Spix'],
    ['calculo subjingival en sextontes dos y cinco', 'calculo subgingival en sextantes dos y cinco'],
    ['corona metal seramica', 'corona metal cerámica'],
    ['paciente con bruquismo', 'paciente con bruxismo'],
    ['se indica clorexidina', 'se indica clorhexidina'],
  ];
  for (const [input, expected] of cases) assert.equal(correctDentalTerms(input).text, expected, input);
});

test('no toca español común ni nombres', () => {
  for (const text of [
    'le traje los exámenes de sangre',
    'vino con su traje de trabajo',
    'paciente de sesenta años, la sexta sesión será en marzo',
    'la señora Gómez trae su carnet',
    'el paciente refiere dolor al masticar desde el lunes',
    'se agenda control en dos semanas',
  ]) {
    assert.equal(correctDentalTerms(text).text, text, text);
    assert.equal(applyLexicon(text).text, text, text);
  }
});

test('el juez acepta términos dentales cercanos y rechaza cambios de término clínico', () => {
  assert.equal(judgeCorrection('necesita esta traje supergival completo', 'necesita destartraje supragingival completo').safe, true);
  assert.equal(judgeCorrection('resina en mesial', 'resina en distal').safe, false);
  assert.equal(judgeCorrection('atrición generalizada', 'abrasión generalizada').safe, false);
  assert.equal(judgeCorrection('cálculo gingival', 'cálculo supragingival').safe, true);
  // Inventar un procedimiento que no se dictó sigue rechazado.
  const r = reconcileCorrection('control sin cambios', 'control sin cambios, se realiza destartraje');
  assert.doesNotMatch(r.text, /destartraje/);
});

test('el glosario para el prompt es corto y trae los términos que suenan parecido', () => {
  const glossary = dentalGlossaryFor(REAL);
  assert.ok(glossary.length <= 40);
  for (const term of ['destartraje', 'destartraje supragingival', 'sextantes', 'pulido coronario']) assert.ok(glossary.includes(term), term);
  // Un término ya bien escrito no trae parecidos que lo puedan reemplazar.
  const g2 = dentalGlossaryFor('atrición generalizada en incisivos inferiores');
  assert.ok(g2.includes('atrición'));
  assert.ok(!g2.includes('abrasión'));
  assert.ok(dentalGlossaryLine(REAL).length < 1200);
});

test('Corregir texto con OpenAI manda el glosario dental en el prompt de sistema', async () => {
  assert.match(correctionSystemPrompt(REAL), /odontológico[\s\S]*destartraje supragingival/);
  const result = await correctWithOpenAi('se realiza tartraje supraginjibal', 'test-secret', {
    fetcher: async (_url, init) => {
      const request = JSON.parse(init.body);
      assert.match(request.messages[0].content, /Glosario odontológico/);
      return Response.json({ choices: [{ message: { content: JSON.stringify({ text: 'se realiza destartraje supragingival' }) } }] });
    },
  });
  assert.equal(result.text, 'se realiza destartraje supragingival');
});

test('el dictado local entrega el texto corregido del caso real', async () => {
  const { proposal } = await proposeFromTranscript({ transcript: REAL }, null, undefined, { today: '2026-11-02' });
  assert.match(proposal.corrected.text, /destartraje supragingival/);
  assert.match(proposal.corrected.text, /6 sextantes/);
});

test('si la IA deja vacía la sección de procedimientos, la nota recoge los procedimientos con cita verificada', () => {
  const transcript = 'Se realiza profilaxis y destartraje supragingival, pulido coronario. Control en seis meses.';
  const ai = validateAiExtraction({
    nota: { indicaciones: 'Control en seis meses.', procedimientos: '' },
    procedimientos: [
      { texto: 'Se realiza profilaxis y destartraje supragingival, pulido coronario.', evidencia: 'Se realiza profilaxis y destartraje supragingival, pulido coronario.' },
      { texto: 'Se realiza exodoncia de la 3.8', evidencia: 'exodoncia de la 3.8' },
    ],
  }, transcript, { today: '2026-11-02' });
  assert.match(ai.noteBody, /Procedimientos realizados\nSe realiza profilaxis y destartraje supragingival, pulido coronario\./);
  assert.doesNotMatch(ai.noteBody, /exodoncia/);
});
