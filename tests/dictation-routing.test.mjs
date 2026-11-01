import test from 'node:test';
import assert from 'node:assert/strict';
import {
  answerLines,
  buildDictatedPerio,
  clarificationQuote,
  proposeFromTranscript,
  verifyDictationSave,
  withAnswers,
} from '../lib/dictation/proposal.ts';
import {
  applyLexicon,
  paymentAmount,
  paymentMethodFrom,
  reconcileCorrection,
  resolveSpokenDate,
  resolveSpokenTime,
  spokenAmounts,
} from '../lib/dictation/spoken.ts';

const TODAY = '2026-11-01'; // domingo
const SAMPLE = 'pieza dos cuatro caries mecial oclusal, sondaje cuatro milímetros en la tres seis con sangrado, abonó cincuenta mil, próxima cita el jueves';
const quiet = () => {};
const run = (text, model = null) => proposeFromTranscript({ transcript: text, chart: [] }, model, quiet, { today: TODAY });

test('diccionario: corrige errores típicos del reconocimiento y deja constancia', () => {
  const { text, corrections } = applyLexicon('caries mecial y distal');
  assert.equal(text, 'caries mesial y distal');
  assert.deepEqual(corrections.map((c) => [c.original, c.corrected, c.origin, c.applied]), [['mecial', 'mesial', 'diccionario', true]]);
});

test('montos, medios de pago, fechas y horas dichas en palabras', () => {
  assert.equal(paymentAmount('abonó cincuenta mil'), 50000);
  assert.equal(paymentAmount('pagó 120.000 con débito'), 120000);
  assert.ok(spokenAmounts('ciento veinte mil').some((a) => a.value === 120000));
  assert.equal(paymentMethodFrom('pagó con tarjeta de débito'), 'debito');
  assert.equal(paymentMethodFrom('por transferencia'), 'transferencia');
  assert.equal(resolveSpokenDate('próxima cita el jueves', TODAY)?.date, '2026-11-05');
  assert.equal(resolveSpokenTime('a las diez y media')?.time, '10:30');
});

test('la IA no puede cambiar cifras ni piezas al corregir el texto', () => {
  const r = reconcileCorrection('pieza dos cuatro caries mesial', 'pieza dos cinco caries mesial');
  assert.equal(r.text, 'pieza dos cuatro caries mesial');
  assert.ok(r.corrections.some((c) => !c.applied && c.reason));
});

test('ejemplo del pedido: cada dato va a su módulo y lo que falta se pregunta', async () => {
  const { proposal: p } = await run(SAMPLE);
  assert.match(p.corrected.text, /caries mesial oclusal/);
  assert.ok(p.corrected.corrections.some((c) => c.original === 'mecial' && c.corrected === 'mesial'));
  assert.deepEqual(p.incomplete.map((i) => [i.tooth, i.surface]).sort(), [[24, 'M'], [24, 'O']]);
  assert.deepEqual(p.perioPending.map((i) => [i.tooth, i.depth, i.bleeding]), [[36, 4, true]]);
  assert.deepEqual(p.payments.map((i) => [i.amount, i.method]), [[50000, null]]);
  assert.deepEqual(p.appointments.map((i) => [i.day, i.time]), [['2026-11-05', null]]);
  const asks = p.clarifications.join('\n');
  assert.match(asks, /ICDAS/);
  assert.match(asks, /medio/);
  assert.match(asks, /hora/);
  assert.match(asks, /sitio/);
});

test('las respuestas a las aclaraciones completan la propuesta antes de guardar', async () => {
  const { proposal: first } = await run(SAMPLE);
  const answer = (re, text) => ({ question: first.clarifications.find((q) => re.test(q)), answer: text });
  const lines = answerLines([
    answer(/ICDAS/, 'ICDAS 3 activa'),
    answer(/medio/, 'efectivo'),
    answer(/hora/, 'a las diez y media'),
    answer(/sitio/, 'mesiovestibular'),
    { question: 'vacía', answer: '   ' },
  ]);
  assert.equal(lines.length, 4);
  assert.ok(lines.every((l) => l.startsWith('Aclaración: ')));
  const text = withAnswers(first.corrected.text, lines);
  assert.equal(withAnswers(text, lines), text, 'no repite aclaraciones ya agregadas');
  const { proposal: p } = await run(text);
  assert.deepEqual(p.odontogram.filter((i) => i.kind === 'surface').map((i) => [i.tooth, i.surface, i.finding.condition, i.finding.icdas, i.finding.activity]).sort(),
    [[24, 'M', 'caries', 3, 'active'], [24, 'O', 'caries', 3, 'active']]);
  assert.equal(p.incomplete.length, 0);
  assert.deepEqual(p.payments.map((i) => [i.amount, i.method]), [[50000, 'efectivo']]);
  assert.deepEqual(p.appointments.map((i) => [i.day, i.time]), [['2026-11-05', '10:30']]);
  assert.deepEqual(p.perio.map((i) => [i.tooth, i.site, i.depth, i.bleeding]), [[36, 'MV', 4, true]]);
  assert.equal(p.perioPending.length, 0);
  assert.equal(p.clarifications.length, 0, p.clarifications.join('\n'));
});

test('clarificationQuote extrae la frase citada sin el recorte', () => {
  assert.equal(clarificationQuote('¿Hora? «próxima cita el jueves…»'), 'próxima cita el jueves');
  assert.equal(clarificationQuote('sin cita'), '');
});

test('IA de prueba: corrige texto y sus pagos/sondajes solo valen con evidencia', async () => {
  const model = {
    model: 'fake',
    complete: () => ({
      nota: { motivo: '', anamnesis: '', examen: '', diagnostico: '', procedimiento: '', indicaciones: '', plan: '' },
      hallazgos: [], procedimientos: [], presupuesto: [], ficha: [],
      texto_corregido: SAMPLE.replace('mecial', 'mesial'),
      periodonto: [
        { pieza: '36', sistema: 'FDI', sitio: '', profundidad: 4, sangrado: true, supuracion: false, evidencia: 'sondaje cuatro milímetros en la tres seis con sangrado' },
        { pieza: '11', sistema: 'FDI', sitio: 'V', profundidad: 7, sangrado: false, supuracion: false, evidencia: 'bolsa de siete en el once' },
      ],
      pagos: [
        { monto: 50000, medio: '', concepto: '', evidencia: 'abonó cincuenta mil' },
        { monto: 900000, medio: 'efectivo', concepto: '', evidencia: 'pagó novecientos mil' },
      ],
      citas: [{ motivo: 'Control', evidencia: 'próxima cita el jueves' }],
      dudas: [],
    }),
  };
  const out = await run(SAMPLE, model);
  assert.equal(out.engine, 'ia+reglas');
  const p = out.proposal;
  assert.match(p.corrected.text, /mesial/);
  assert.deepEqual(p.payments.map((i) => i.amount), [50000]);
  assert.ok(!p.perio.some((i) => i.tooth === 11) && !p.perioPending.some((i) => i.tooth === 11));
  assert.equal(p.appointments.length, 1);
});

test('el periodontograma dictado solo contiene los sitios aceptados', () => {
  const teeth = buildDictatedPerio([{ tooth: 36, site: 'MV', depth: 4, bleeding: true, suppuration: false }], [{ tooth: 41, grade: 'II' }]);
  assert.deepEqual(teeth, {
    36: { sites: { MV: { depth: 4, margin: null, bleeding: true, suppuration: false } }, mobility: '', furcation: '' },
    41: { sites: {}, mobility: 'II', furcation: '' },
  });
});

test('verificación al releer: pagos, citas y periodontograma', () => {
  const base = { patientId: 1, before: { teeth: {}, surfaces: {} }, note: null, accepted: [], budgets: [] };
  const snapshot = {
    notes: [], budgets: [], toothStatuses: {},
    payments: [{ id: 7, patientId: 1, amount: 50000, method: 'efectivo' }],
    appointments: [{ id: 9, patientId: 1, day: '05-11-2026', time: '10:30', reason: 'Control' }],
    periodontalExams: { 1: [{ id: 3, teeth: { 36: { sites: { MV: { depth: 4, bleeding: true, suppuration: false } }, mobility: '' } } }] },
  };
  const ok = verifyDictationSave({
    ...base,
    payments: [{ amount: 50000, method: 'efectivo', savedId: 7 }],
    appointments: [{ day: '2026-11-05', time: '10:30', reason: 'Control', savedId: 9 }],
    perio: { examId: 3, readings: [{ tooth: 36, site: 'MV', depth: 4, bleeding: true, suppuration: false }], mobility: [] },
  }, snapshot);
  assert.equal(ok.ok, true, ok.messages.join('\n'));
  const bad = verifyDictationSave({
    ...base,
    payments: [{ amount: 60000, method: 'efectivo' }],
    appointments: [{ day: '2026-11-05', time: '11:00', reason: 'Control' }],
    perio: { examId: 3, readings: [{ tooth: 36, site: 'MV', depth: 5, bleeding: true, suppuration: false }], mobility: [] },
  }, snapshot);
  assert.equal(bad.ok, false);
  assert.equal(bad.messages.filter((m) => /no aparece|no coincide/.test(m)).length, 3);
});

test('sitio del sondaje dicho junto, separado o con guion', async () => {
  for (const [said, site] of [['mesiovestibular', 'MV'], ['mesio vestibular', 'MV'], ['disto-lingual', 'DL'], ['palatino', 'L']]) {
    const { proposal } = await run(`sondaje cinco milímetros en la tres seis ${said}`);
    assert.deepEqual(proposal.perio.map((i) => [i.tooth, i.site, i.depth]), [[36, site, 5]], said);
  }
});

test('IA con texto corregido en cifras: la pieza «3.6» sin etiqueta y la cita sobre lo corregido por diccionario valen', async () => {
  const model = {
    model: 'fake',
    complete: () => ({
      nota: { motivo: '', anamnesis: '', examen: '', diagnostico: '', procedimiento: '', indicaciones: '', plan: '' },
      hallazgos: [{ tipo: 'superficie', pieza: '24', sistema: 'FDI', caras: ['M', 'O'], condicion: 'caries', icdas: null, actividad: '', evidencia: 'pieza dos cuatro caries mesial oclusal' }],
      procedimientos: [], presupuesto: [], ficha: [], periodonto: [], pagos: [], citas: [], dudas: [],
      texto_corregido: 'pieza 2.4 caries mesial oclusal, sondaje 4 mm en la 3.6 con sangrado, abonó 50.000, próxima cita el jueves',
    }),
  };
  const p = (await run(SAMPLE, model)).proposal;
  assert.match(p.corrected.text, /en la 3\.6/);
  assert.ok(!p.clarifications.some((c) => /sin una pieza identificada|sin una cita literal/.test(c)), p.clarifications.join('\n'));
  assert.deepEqual([...p.perio, ...p.perioPending].map((i) => [i.tooth, i.depth, i.bleeding]), [[36, 4, true]]);
});

test('una medida o una hora con punto no se lee como pieza', async () => {
  const p = (await run('sondaje 4.5 mm en pieza 3.6, abonó 50.000 a las 10.30')).proposal;
  assert.ok(![...p.perio, ...p.perioPending, ...p.odontogram].some((i) => i.tooth === 45 || i.tooth === 13));
});

test('IA: una aclaración en cifras completa el ítem citado en palabras, sin avisos sobrantes', async () => {
  const text = `${SAMPLE}\nAclaración: pieza 2.4 caries mesial oclusal: ICDAS 3 activa.\nAclaración: sondaje cuatro milímetros en la tres seis con sangrado: mesiovestibular.`;
  const model = {
    model: 'fake',
    complete: () => ({
      nota: { motivo: '', anamnesis: '', examen: '', diagnostico: '', procedimiento: '', indicaciones: '', plan: '' },
      hallazgos: [{ tipo: 'superficie', pieza: '24', sistema: 'FDI', caras: ['M', 'O'], condicion: 'caries', icdas: 3, actividad: 'activa', evidencia: 'pieza dos cuatro caries mesial oclusal' }],
      periodonto: [{ pieza: '36', sistema: 'FDI', sitio: 'MV', profundidad: 4, sangrado: true, supuracion: false, evidencia: 'sondaje cuatro milímetros en la tres seis con sangrado' }],
      procedimientos: [], presupuesto: [], ficha: [], pagos: [], citas: [], dudas: [], texto_corregido: '',
    }),
  };
  const p = (await run(text, model)).proposal;
  assert.ok(!p.clarifications.some((c) => /la IA indicó|sin ICDAS/.test(c)), p.clarifications.join('\n'));
  assert.deepEqual(p.perio.map((i) => [i.tooth, i.site, i.depth, i.origin]), [[36, 'MV', 4, 'ia+reglas']]);
  assert.ok(p.odontogram.some((i) => i.tooth === 24 && i.origin === 'ia+reglas' && i.finding.icdas === 3));
});
