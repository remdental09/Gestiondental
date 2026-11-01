import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chileToFdi,
  formatFdi,
  parseModelJson,
  planChartWrites,
  proposeFromTranscript,
  structureTranscript,
  universalToFdi,
  validateProposal,
  verifyDictationSave,
} from '../lib/dictation/proposal.ts';

const emptyChart = { teeth: {}, surfaces: {}, missingReason: {}, crowns: {} };

test('FDI con punto y equivalencias chilena y universal no se cruzan', () => {
  assert.equal(formatFdi(12), '1.2');
  assert.equal(formatFdi(36), '3.6');
  assert.equal(chileToFdi(12), 24);
  assert.equal(chileToFdi(30), 36);
  assert.equal(chileToFdi(19), 46);
  assert.equal(universalToFdi(19), 36);
  assert.equal(universalToFdi(30), 46);
  assert.equal(formatFdi(chileToFdi(30)), '3.6');
  assert.equal(formatFdi(chileToFdi(19)), '4.6');
});

test('separa caries por profundidad del estado general y conserva el relato', () => {
  const proposal = structureTranscript('El paciente refiere dolor al frío. Se observa caries en la cara oclusal de la pieza FDI 3.6, de dentina profunda. No se confirma diagnóstico de pulpitis.');
  assert.equal(proposal.odontogram.length, 1);
  assert.equal(proposal.odontogram[0].tooth, 36);
  assert.equal(proposal.odontogram[0].kind, 'surface');
  assert.equal(proposal.odontogram[0].surface, 'O');
  assert.deepEqual(proposal.odontogram[0].finding, { condition: 'caries', depth: 'dentina_profunda', icdas: null, activity: null });
  assert.equal(proposal.odontogram.some((item) => item.kind !== 'surface'), false);
  assert.match(proposal.evolution.body, /refiere dolor al frío/i);
  assert.match(proposal.evolution.body, /FDI 3\.6 \(Chile 30\): caries de dentina profunda oclusal \(CIE-11 DA08\.0&XA6FX3 Caries dental · Dentina\)\./);
  assert.equal(/profundidad de la caries/.test(proposal.clarifications.join(' ')), false, 'con profundidad dictada no se pregunta');
  assert.match(proposal.clarifications.join(' '), /diagnóstico confirmado/i);
  assert.equal(JSON.stringify(proposal).includes('"diagnosis"'), false);
});

test('pieza 12 sin etiqueta es nacional chilena y no FDI 1.2', () => {
  const proposal = structureTranscript('Pieza 12 con obturación oclusal.');
  assert.equal(proposal.odontogram.length, 1);
  assert.equal(proposal.odontogram[0].tooth, 24);
  assert.equal(proposal.odontogram[0].numbering, 'chilena');
  assert.equal(proposal.odontogram[0].finding.condition, 'restored');
  assert.equal(proposal.odontogram[0].surface, 'O');
});

test('FDI 1.2 sana en vestibular queda en el código 12', () => {
  const proposal = structureTranscript('FDI 1.2 sana en vestibular.');
  assert.equal(proposal.odontogram[0].tooth, 12);
  assert.equal(proposal.odontogram[0].numbering, 'FDI');
  assert.equal(proposal.odontogram[0].surface, 'V');
  assert.equal(proposal.odontogram[0].finding.condition, 'sound');
});

test('sin etiqueta: 1 a 32 es chilena, 33 a 48 y 51 a 85 es FDI, con punto es FDI', () => {
  const chile = structureTranscript('Pieza 30 con obturación oclusal.');
  assert.deepEqual(chile.odontogram.map((i) => [i.tooth, i.numbering]), [[36, 'chilena']]);
  assert.equal(chile.clarifications.some((q) => /pieza 30/.test(q)), false, 'pieza 30 no se pregunta');
  const fdi = structureTranscript('Pieza 46 ausente.');
  assert.deepEqual(fdi.odontogram.map((i) => [i.tooth, i.numbering, i.status]), [[46, 'FDI', 'Ausente']]);
  const deciduous = structureTranscript('Pieza 55 ausente.');
  assert.deepEqual(deciduous.odontogram.map((i) => [i.tooth, i.numbering]), [[55, 'FDI']]);
  const dotted = structureTranscript('Pieza 2.6 con obturación oclusal.');
  assert.deepEqual(dotted.odontogram.map((i) => [i.tooth, i.numbering]), [[26, 'FDI']]);
  const spoken = structureTranscript('Pieza dos punto seis con obturación oclusal.');
  assert.deepEqual(spoken.odontogram.map((i) => i.tooth), [26]);
});

test('solo se pregunta la pieza si el número no es válido en ningún sistema', () => {
  for (const n of ['39', '40', '49', '50', '86']) {
    const proposal = structureTranscript(`Pieza ${n} con obturación oclusal.`);
    assert.equal(proposal.odontogram.length, 0, n);
    const asks = proposal.clarifications.filter((q) => q.includes(`pieza ${n}`));
    assert.equal(asks.length, 1, `${n}: ${proposal.clarifications.join(' | ')}`);
    assert.match(asks[0], /ni en numeración chilena \(1–32\) ni en FDI \(33–48, 51–85\)\. ¿Qué pieza\?/);
  }
});

test('universal 19 y chilena 19 apuntan a piezas distintas', () => {
  const universal = structureTranscript('Universal 19 ausente.');
  const chile = structureTranscript('Pieza 19 ausente.');
  assert.equal(universal.odontogram[0].tooth, 36);
  assert.equal(universal.odontogram[0].status, 'Ausente');
  assert.equal(chile.odontogram[0].tooth, 46);
  assert.equal(chile.odontogram[0].numbering, 'chilena');
});

test('niega se conserva y no se inventan otras negaciones', () => {
  const proposal = structureTranscript('Niega alergia a penicilina.');
  assert.match(proposal.evolution.body, /Niega alergia a penicilina/);
  assert.equal(/niega medicamentos/i.test(proposal.evolution.body), false);
  assert.equal(/sin alergias/i.test(proposal.evolution.body), false);
  assert.equal(proposal.odontogram.length, 0);
});

test('el relato de una extracción no marca la pieza ausente', () => {
  const proposal = structureTranscript('El paciente refiere que le extrajeron la pieza 30.');
  assert.equal(proposal.odontogram.length, 0);
  assert.match(proposal.clarifications.join(' '), /no hallazgo confirmado/i);
  assert.match(proposal.evolution.body, /extrajeron la pieza 30/i);
});

test('un presupuesto no cementa la corona y una cementación sí propone el estado', () => {
  const quote = structureTranscript('Presupuesto de corona en zirconio, 350000 pesos, pieza FDI 1.1.');
  assert.equal(quote.odontogram.length, 0);
  assert.equal(quote.budget.length, 1);
  assert.equal(quote.budget[0].amount, 350000);
  assert.match(quote.budget[0].label, /corona/i);
  const cemented = structureTranscript('Se cementó corona de zirconio color A2 en FDI 2.1.');
  assert.equal(cemented.odontogram[0].kind, 'crown');
  assert.equal(cemented.odontogram[0].tooth, 21);
  assert.equal(cemented.odontogram[0].material, 'Zirconio');
  assert.equal(cemented.odontogram[0].shade, 'A2');
});

test('un implante planificado no cambia el odontograma y uno instalado sí', () => {
  assert.equal(structureTranscript('Se planifica implante en pieza 30.').odontogram.length, 0);
  const placed = structureTranscript('Se instaló un implante en la pieza 30.');
  assert.equal(placed.odontogram[0].tooth, 36);
  assert.equal(placed.odontogram[0].status, 'Implante');
});

test('el sondaje queda anotado y no se persiste', () => {
  const proposal = structureTranscript('Sondaje de 4 mm en mesial vestibular de FDI 1.6.');
  assert.equal(proposal.perio.length, 1);
  assert.equal(proposal.perio[0].tooth, 16);
  assert.equal(proposal.perio[0].site, 'MV');
  assert.equal(proposal.perio[0].depth, 4);
  assert.equal(proposal.perio[0].persisted, false);
  assert.equal(proposal.odontogram.length, 0);
});

test('la dentición temporal FDI 5.5 acepta sellante oclusal', () => {
  const proposal = structureTranscript('Se observa sellante en oclusal de la pieza FDI 5.5.');
  assert.equal(proposal.odontogram[0].tooth, 55);
  assert.equal(proposal.odontogram[0].surface, 'O');
  assert.equal(proposal.odontogram[0].finding.condition, 'sealant');
});

test('el JSON del modelo se valida: descarta pieza inválida y sondaje persistido; la caries sin profundidad se acepta', () => {
  const raw = '```json\n' + JSON.stringify({
    evolution: { title: 'Nota', body: 'Texto de prueba.' },
    odontogram: [
      { tooth: 99, numbering: 'FDI', numberingLabel: '99', sourceText: 'pieza inválida', kind: 'status', status: 'Ausente' },
      { tooth: 36, numbering: 'FDI', numberingLabel: 'FDI 3.6', sourceText: 'caries', kind: 'surface', surface: 'O', finding: { condition: 'caries', icdas: null, activity: null } },
    ],
    budget: [],
    perio: [{ tooth: 16, numberingLabel: 'FDI 1.6', site: 'V', siteLabel: 'Vestibular', depth: 3, sourceText: 'sondaje', persisted: true }],
    clarifications: [],
  }) + '\n```';
  const proposal = validateProposal(parseModelJson(raw));
  assert.equal(proposal.odontogram.length, 1);
  assert.deepEqual(proposal.odontogram[0].finding, { condition: 'caries', depth: null, icdas: null, activity: null });
  assert.equal(proposal.perio.length, 1);
  assert.equal(proposal.perio[0].persisted, false);
  assert.match(proposal.clarifications.join(' '), /no es un FDI válido/i);
  assert.match(proposal.clarifications.join(' '), /no se guarda/i);
});

const NOTE_KEYS = ['motivo', 'anamnesis', 'alergias', 'medicamentos', 'examen', 'diagnostico', 'procedimientos', 'plan', 'indicaciones', 'presupuesto'];
const hallazgo = (fields) => ({ pieza: '', sistema: 'chilena', tipo: 'superficie', condicion: '', estado: '', caras: [], icdas: 0, actividad: '', material: '', color: '', evidencia: '', ...fields });
const aiOutput = ({ nota = {}, hallazgos = [], procedimientos = [], presupuesto = [], ficha = [], dudas = [] } = {}) => ({
  nota: Object.fromEntries(NOTE_KEYS.map((key) => [key, nota[key] ?? ''])),
  hallazgos, procedimientos, presupuesto, ficha, dudas,
});
const mockModel = (output, onCall = () => {}) => ({
  id: 'workers-ai',
  model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  complete: async (input) => { onCall(input); return typeof output === 'function' ? output(input) : output; },
});

test('sin Workers AI se usa el estructurador local y una IA fallida lo avisa', async () => {
  const local = await proposeFromTranscript({ transcript: 'Pieza 12 con obturación oclusal.', chart: [] }, null);
  assert.equal(local.engine, 'reglas-locales');
  assert.match(local.notice, /Workers AI no está enlazado/);
  assert.equal(local.proposal.odontogram[0].tooth, 24);
  assert.equal(local.proposal.odontogram[0].origin, 'reglas');

  const events = [];
  const failed = await proposeFromTranscript({ transcript: 'Pieza 12 con obturación oclusal.', chart: [] }, {
    id: 'workers-ai', model: 'modelo-de-prueba', complete: async () => { throw new Error('sin cuota'); },
  }, (event, detail) => events.push({ event, detail }));
  assert.equal(failed.engine, 'reglas-locales');
  assert.equal(failed.model, null);
  assert.match(failed.notice, /La IA no respondió.*reglas locales.*sin cuota/);
  assert.equal(failed.proposal.odontogram[0].tooth, 24);
  assert.equal(events[0].event, 'dictation.ai_failed');
  assert.equal(JSON.stringify(events).includes('obturación'), false);

  // El formato antiguo (sin «nota») no se acepta: se usan las reglas.
  const legacy = await proposeFromTranscript({ transcript: 'Pieza 12 con obturación oclusal.', chart: [] }, mockModel({
    evolution: { title: 'Nota', body: 'x' },
    odontogram: [{ tooth: 11, numbering: 'FDI', numberingLabel: 'FDI 1.1', sourceText: 'modelo', kind: 'status', status: 'Ausente' }],
  }));
  assert.equal(legacy.engine, 'reglas-locales');
  assert.equal(legacy.proposal.odontogram.some((item) => item.tooth === 11), false);
});

test('una IA que no responde a tiempo cae a las reglas', async () => {
  const outcome = await proposeFromTranscript({ transcript: 'Pieza 30 con obturación oclusal pieza 19 ausente', chart: [] }, {
    id: 'workers-ai', model: 'lento', complete: () => new Promise(() => {}),
  }, () => {}, { timeoutMs: 30 });
  assert.equal(outcome.engine, 'reglas-locales');
  assert.match(outcome.notice, /sin respuesta/);
  assert.ok(outcome.aiMs >= 25);
  assert.deepEqual(outcome.proposal.odontogram.map((item) => item.tooth).sort(), [36, 46]);
});

test('la IA redacta la nota y sus hallazgos con cita válida se cruzan con las reglas', async () => {
  const transcript = 'paciente refiere sensibilidad al frío niega alergias pieza 30 con obturación oclusal pieza 19 ausente pieza 14 caries mesial de esmalte punto se indica control en 6 meses';
  let seen = null;
  const events = [];
  const outcome = await proposeFromTranscript({ transcript, chart: [] }, mockModel({ usedModel: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', output: aiOutput({
    nota: { motivo: 'Refiere sensibilidad al frío.', alergias: 'Niega alergias.', examen: 'Pieza 30 con obturación oclusal. Pieza 19 ausente. Pieza 14 con caries mesial de esmalte.', indicaciones: 'Control en 6 meses.' },
    hallazgos: [
      hallazgo({ pieza: '30', condicion: 'obturacion', caras: ['O'], evidencia: 'pieza 30 con obturación oclusal' }),
      hallazgo({ pieza: '19', tipo: 'estado', estado: 'Ausente', evidencia: 'pieza 19 ausente' }),
      hallazgo({ pieza: '14', condicion: 'caries', caras: ['M'], profundidad: 'esmalte', evidencia: 'pieza 14 caries mesial de esmalte' }),
    ],
    ficha: [{ campo: 'alergias', texto: 'Niega alergias', evidencia: 'niega alergias' }],
  }) }, (input) => { seen = input; }), (event, detail) => events.push({ event, detail }));
  assert.equal(seen.transcript, transcript);
  assert.equal(outcome.engine, 'ia+reglas');
  assert.equal(outcome.model, '@cf/meta/llama-3.3-70b-instruct-fp8-fast');
  assert.match(outcome.notice, /La IA redactó la nota/);
  const items = outcome.proposal.odontogram;
  assert.deepEqual(items.map((item) => [item.tooth, item.surface ?? item.status, item.origin]).sort(), [[24 + 2, 'M', 'ia+reglas'], [36, 'O', 'ia+reglas'], [46, 'Ausente', 'ia+reglas']].sort());
  assert.equal(items.every((item) => item.evidence && transcript.includes(item.evidence)), true);
  assert.deepEqual(items.find((item) => item.tooth === 26).finding, { condition: 'caries', depth: 'esmalte', icdas: null, activity: null });
  assert.match(outcome.proposal.evolution.body, /FDI 2\.6 \(Chile 14\): caries de esmalte mesial \(CIE-11 DA08\.0&XA5R09 Caries dental · Esmalte\)\./);
  assert.deepEqual(outcome.proposal.diagnoses.map((item) => [item.tooth, item.code]), [[26, 'DA08.0&XA5R09']]);
  const body = outcome.proposal.evolution.body;
  assert.match(body, /^Motivo de consulta\nRefiere sensibilidad al frío\./);
  assert.match(body, /Examen \(odontograma\)\nFDI 3\.6 \(Chile 30\): obturación oclusal\.\nFDI 4\.6 \(Chile 19\): ausente\./);
  assert.equal(outcome.proposal.ficha.length, 1);
  assert.equal(outcome.proposal.ficha[0].field, 'allergies');
  assert.equal(outcome.proposal.ficha[0].origin, 'ia+reglas');
  assert.equal(outcome.proposal.transcript, transcript);
  assert.equal(events[0].event, 'dictation.ai_ok');
  assert.equal(JSON.stringify(events).includes('obturación'), false);
});

test('la IA no cuela piezas, caras, profundidades ni montos sin cita literal', async () => {
  const transcript = 'Pieza 30 caries distal. Pieza 3 con fractura de la cúspide mesiopalatina y obturación oclusal de amalgama. Presupuesto corona pieza 3 350 mil pesos.';
  const outcome = await proposeFromTranscript({ transcript, chart: [] }, mockModel(aiOutput({
    nota: { examen: 'Pieza 30 con caries distal de dentina profunda, ICDAS 4. Pieza 3 fracturada.' },
    hallazgos: [
      // Profundidad inventada: la cita no la tiene.
      hallazgo({ pieza: '30', condicion: 'caries', caras: ['D'], profundidad: 'dentina_profunda', evidencia: 'Pieza 30 caries distal' }),
      // Caras de la fractura atribuidas a la obturación.
      hallazgo({ pieza: '3', condicion: 'obturacion', caras: ['M', 'P', 'O'], evidencia: 'Pieza 3 con fractura de la cúspide mesiopalatina y obturación oclusal de amalgama' }),
      // Cita que no está en el dictado.
      hallazgo({ pieza: '12', tipo: 'estado', estado: 'Ausente', evidencia: 'pieza 12 ausente' }),
      // Pieza que no está en la cita.
      hallazgo({ pieza: '5', tipo: 'estado', estado: 'Corona', evidencia: 'Presupuesto corona pieza 3' }),
    ],
    presupuesto: [
      { prestacion: 'Corona', monto: 350000, evidencia: 'Presupuesto corona pieza 3 350 mil pesos' },
      { prestacion: 'Endodoncia', monto: 120000, evidencia: 'Presupuesto corona pieza 3 350 mil pesos' },
    ],
  })));
  assert.equal(outcome.engine, 'ia+reglas');
  const items = outcome.proposal.odontogram;
  assert.equal(items.some((item) => item.tooth === 24 || item.tooth === 15 || item.kind === 'crown'), false);
  // La caries entra con lo dictado (sin profundidad); la profundidad inventada no se usa y se pregunta, opcional.
  assert.deepEqual(items.filter((item) => item.tooth === 36).map((item) => [item.surface, item.finding.condition, item.finding.depth]), [['D', 'caries', null]]);
  assert.equal(outcome.proposal.incomplete.length, 0);
  const asks = outcome.proposal.clarifications;
  assert.ok(asks.some((q) => /FDI 3\.6: la IA indicó caries de dentina profunda, pero el dictado no dice la profundidad/.test(q)), asks.join('\n'));
  assert.equal(asks.filter((q) => /FDI 3\.6: .*¿profundidad de la caries/.test(q)).length, 1, 'IA y reglas no preguntan dos veces lo mismo');
  const molar = items.filter((item) => item.tooth === 16);
  assert.deepEqual(molar.map((item) => item.surface), ['O']);
  assert.equal(molar[0].finding.condition, 'restored');
  assert.equal(outcome.proposal.budget.length, 1);
  assert.equal(outcome.proposal.budget[0].amount, 350000);
  assert.equal(/Falta el monto/.test(outcome.proposal.clarifications.join(' ')), false);
  // La nota se queda, pero el ICDAS que no se dictó queda marcado para revisar.
  assert.match(outcome.proposal.clarifications.join(' '), /«4», que no aparece en el dictado/);
});

test('IA y reglas en desacuerdo quedan marcadas como conflicto y fuera del registro', async () => {
  const transcript = 'Pieza 12 obturación oclusal de resina.';
  const outcome = await proposeFromTranscript({ transcript, chart: [] }, mockModel(aiOutput({
    nota: { examen: 'Pieza 12 con caries oclusal.' },
    hallazgos: [hallazgo({ pieza: '12', condicion: 'sellante', caras: ['O'], evidencia: 'Pieza 12 obturación oclusal de resina' })],
  })));
  const items = outcome.proposal.odontogram.filter((item) => item.tooth === 24);
  assert.ok(items.length >= 1);
  if (items.length === 2) {
    assert.equal(items.every((item) => item.conflict), true);
    assert.match(outcome.proposal.clarifications.join(' '), /no coinciden/);
    assert.equal(outcome.proposal.evolution.body.includes('FDI 2.4'), false);
  } else {
    // El validador ya descartó el sellante sin respaldo en la cita.
    assert.equal(items[0].finding.condition, 'restored');
  }
});

test('dictados chilenos de caries, sellado, sondaje, presupuesto y corona cementada', () => {
  const vestibular = structureTranscript('Se observa caries vestibular en FDI 1.6, ICDAS 2, inactiva.');
  assert.equal(vestibular.odontogram[0].tooth, 16);
  assert.equal(vestibular.odontogram[0].surface, 'V');
  assert.deepEqual(vestibular.odontogram[0].finding, { condition: 'caries', depth: null, icdas: 2, activity: 'inactive' });

  const probing = structureTranscript('Sondaje de 5 mm en distal lingual de la pieza chilena 19.');
  assert.equal(probing.perio[0].tooth, 46);
  assert.equal(probing.perio[0].site, 'DL');
  assert.equal(probing.perio[0].depth, 5);
  assert.equal(probing.perio[0].persisted, false);
  assert.equal(probing.odontogram.length, 0);

  const budget = structureTranscript('Presupuesto de limpieza, 25000 pesos.');
  assert.equal(budget.odontogram.length, 0);
  assert.equal(budget.budget[0].amount, 25000);
  assert.match(budget.budget[0].label, /limpieza/i);

  const crown = structureTranscript('Se cementó corona de disilicato color B1 en pieza FDI 4.6.');
  assert.equal(crown.odontogram[0].kind, 'crown');
  assert.equal(crown.odontogram[0].tooth, 46);
  assert.equal(crown.odontogram[0].material, 'Disilicato');
  assert.equal(crown.odontogram[0].shade, 'B1');
});

test('dos dictados chilenos reales no mezclan piezas ni contradicen las aclaraciones', async () => {
  const caries = 'Pieza 30 caries oclusal ICDAS 3 activa. Pieza 12 obturación oclusal de resina. Se indica control en 6 meses.';
  const crown = 'Pieza 19 corona metal porcelana. Pieza 3 ausente por extracción. Presupuesto: resina pieza 12.';
  const confused = {
    id: 'workers-ai',
    model: '@cf/meta/llama-3.1-8b-instruct-fast',
    complete: async () => ({
      evolution: { title: 'Evolución', body: 'El paciente refiere caries oclusal en pieza 30 con ICDAS 3 y actividad activa. También refiere obturación oclusal de resina en pieza 12. El paciente se indica control en 6 meses.' },
      odontogram: [{ tooth: 24, numbering: 'chilena', numberingLabel: 'Pieza 30', sourceText: 'Pieza 30 caries oclusal ICDAS 3 activa.', kind: 'surface', surface: 'O', finding: { condition: 'restored', icdas: null, activity: null } }],
      budget: [],
      perio: [],
      clarifications: ['Caries sin ICDAS y actividad completos, sin cambio de superficie: «Pieza 30 caries oclusal ICDAS 3 activa».'],
    }),
  };
  const first = await proposeFromTranscript({ transcript: caries, chart: [] }, confused);
  const lesion = first.proposal.odontogram.find((item) => item.tooth === 36);
  const filling = first.proposal.odontogram.find((item) => item.tooth === 24);
  assert.equal(first.proposal.odontogram.length, 2);
  assert.equal(lesion.numberingLabel.includes('3.6'), true);
  assert.equal(lesion.sourceText.includes('Pieza 30'), true);
  assert.equal(lesion.sourceText.includes('Pieza 12'), false);
  assert.equal(lesion.surface, 'O');
  assert.deepEqual(lesion.finding, { condition: 'caries', depth: null, icdas: 3, activity: 'active' });
  assert.equal(filling.numberingLabel.includes('2.4'), true);
  assert.equal(filling.sourceText.includes('Pieza 12'), true);
  assert.equal(filling.sourceText.includes('Pieza 30'), false);
  assert.equal(filling.finding.condition, 'restored');
  assert.equal(/refiere|relata/i.test(first.proposal.evolution.body), false);
  assert.match(first.proposal.evolution.body, /FDI 3\.6 \(Chile 30\): caries \(profundidad no consignada\) oclusal, ICDAS 3, activa \(CIE-11 DA08\.0 Caries dental\)/);
  assert.match(first.proposal.evolution.body, /control en 6 meses/);
  assert.equal(/ICDAS y actividad|no es un FDI válido|lectura local|se dejó fuera/i.test(first.proposal.clarifications.join(' ')), false);

  const second = await proposeFromTranscript({ transcript: crown, chart: [] }, {
    ...confused,
    complete: async () => ({
      evolution: { title: 'Evolución', body: 'El paciente refiere una corona y una ausencia.' },
      odontogram: [],
      budget: [],
      perio: [],
      clarifications: [
        'La pieza 19 no es un FDI válido y se dejó fuera.',
        'La pieza 3 no es un FDI válido y se dejó fuera.',
        'El odontograma sigue la lectura local del dictado, porque el modelo no dejó un cambio compatible.',
      ],
    }),
  });
  const observedCrown = second.proposal.odontogram.find((item) => item.tooth === 46);
  const missing = second.proposal.odontogram.find((item) => item.tooth === 16);
  assert.equal(observedCrown.kind, 'crown');
  assert.equal(observedCrown.status, 'Corona');
  assert.equal(observedCrown.material, 'Metal cerámica');
  assert.equal(observedCrown.numberingLabel.includes('4.6'), true);
  assert.equal(observedCrown.sourceText.includes('Pieza 19'), true);
  assert.equal(missing.status, 'Ausente');
  assert.equal(missing.missingReason, 'other');
  assert.equal(missing.numberingLabel.includes('1.6'), true);
  assert.equal(missing.sourceText.includes('Pieza 3'), true);
  assert.equal(second.proposal.budget.length, 1);
  assert.equal(second.proposal.budget[0].amount, 0);
  assert.match(second.proposal.budget[0].label, /resina/i);
  assert.match(second.proposal.clarifications.join(' '), /Falta el monto/);
  assert.equal(/no es un FDI válido|lectura local|se dejó fuera/i.test(second.proposal.clarifications.join(' ')), false);
  assert.equal(/refiere|relata/i.test(second.proposal.evolution.body), false);
});

test('el dictado en vivo no mezcla ICDAS con actividad ni incorpora la pieza sin marcar', async () => {
  const transcript = 'Pieza 3.6 caries MOD ICDAS 4 activa. Pieza 8 caries palatina ICDAS 2 inactiva. Pieza 24 obturación vestibular. Pieza 19 lingual caries ICDAS 3 activa. Pieza 12 incisal caries ICDAS 2 activa.';
  const invented = 'La pieza 3.6 presenta caries MOD con un grado de actividad ICDAS 4. La pieza 8 tiene caries palatina con un grado de actividad ICDAS 2. La pieza 24 tiene obturación vestibular. La pieza 19 tiene caries lingual con un grado de actividad ICDAS 3. La pieza 12 tiene caries incisal con un grado de actividad ICDAS 2. Se contempla realizar un tratamiento. Hay extracción previa.';
  let called = false;
  const outcome = await proposeFromTranscript({ transcript, chart: [] }, {
    id: 'workers-ai',
    model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    complete: async () => {
      called = true;
      return { title: 'Evolución', body: invented };
    },
  });
  assert.equal(called, true);
  assert.equal(outcome.engine, 'reglas-locales');
  const proposal = outcome.proposal;
  const teeth = proposal.odontogram.map((item) => item.tooth);
  assert.deepEqual([...new Set(teeth)], [36, 11, 41, 46]);
  assert.equal(proposal.odontogram.some((item) => item.tooth === 24), false);
  const byTooth = (tooth) => proposal.odontogram.filter((item) => item.tooth === tooth);
  assert.deepEqual(byTooth(36).map((item) => item.surface).sort(), ['D', 'M', 'O']);
  assert.deepEqual(byTooth(36)[0].finding, { condition: 'caries', depth: null, icdas: 4, activity: 'active' });
  assert.equal(byTooth(11)[0].surface, 'P');
  assert.deepEqual(byTooth(11)[0].finding, { condition: 'caries', depth: null, icdas: 2, activity: 'inactive' });
  assert.equal(byTooth(41)[0].finding.condition, 'restored');
  assert.equal(byTooth(41)[0].surface, 'V');
  assert.equal(byTooth(46)[0].surface, 'P');
  assert.deepEqual(byTooth(46)[0].finding, { condition: 'caries', depth: null, icdas: 3, activity: 'active' });

  const body = proposal.evolution.body;
  const exam = body.split('Pendiente de aclarar')[0];
  // Un ICDAS dictado (registro anterior) se conserva en la nota junto al código CIE-11 sin profundidad.
  assert.match(exam, /Examen \(odontograma\)\nFDI 3\.6 \(Chile 30\): caries \(profundidad no consignada\) M-O-D, ICDAS 4, activa \(CIE-11 DA08\.0 Caries dental\)\./);
  assert.match(exam, /FDI 1\.1 \(Chile 8\): caries \(profundidad no consignada\) palatina, ICDAS 2, inactiva \(CIE-11 DA08\.0 Caries dental\)\./);
  assert.match(exam, /FDI 4\.1 \(Chile 24\): obturación vestibular\./);
  assert.match(exam, /FDI 4\.6 \(Chile 19\): caries \(profundidad no consignada\) lingual, ICDAS 3, activa \(CIE-11 DA08\.0 Caries dental\)\./);
  assert.equal(/incisal|grado de actividad|extracción previa|se contempla|tratamiento/i.test(exam), false);
  assert.match(body, /Pendiente de aclarar/);
  assert.match(body, /Pieza 12 incisal caries ICDAS 2 activa/);
  assert.match(proposal.clarifications.join(' '), /FDI 2\.4.*incisal.*posterior.*no se marcó/);
  assert.equal(/grado de actividad|extracción previa|se contempla|tratamiento/i.test(body), false);
  assert.equal(body.includes(invented), false);
});

test('corona, implante y corona sobre implante quedan en registros distintos', () => {
  const natural = structureTranscript('Corona en pieza 12.');
  assert.equal(natural.odontogram.length, 1);
  assert.equal(natural.odontogram[0].tooth, 24);
  assert.equal(natural.odontogram[0].kind, 'crown');
  assert.equal(natural.odontogram[0].foundation, 'tooth');
  assert.equal(natural.odontogram.some((item) => item.status === 'Implante'), false);

  const implant = structureTranscript('Implante en pieza 30.');
  assert.equal(implant.odontogram.length, 1);
  assert.equal(implant.odontogram[0].tooth, 36);
  assert.equal(implant.odontogram[0].status, 'Implante');
  assert.equal(implant.odontogram.some((item) => item.kind === 'crown'), false);

  const both = structureTranscript('Corona sobre implante en pieza 19.');
  const implantItem = both.odontogram.find((item) => item.status === 'Implante');
  const crownItem = both.odontogram.find((item) => item.kind === 'crown');
  assert.equal(both.odontogram.length, 2);
  assert.equal(implantItem.tooth, 46);
  assert.equal(crownItem.tooth, 46);
  assert.equal(crownItem.foundation, 'implant');
  assert.match(both.evolution.body, /FDI 4\.6 \(Chile 19\): implante\. corona sobre implante/);
  const writes = planChartWrites(1, emptyChart, emptyChart, both.odontogram);
  assert.equal(writes.some((item) => item.action === 'setToothStatus' && item.status === 'Corona'), false);
  assert.equal(writes.some((item) => item.action === 'setToothStatus' && item.status === 'Implante'), true);
  assert.equal(writes.some((item) => item.action === 'setCrownDetails' && item.foundation === 'implant'), true);

  const quote = structureTranscript('Presupuesto de corona en pieza 12, 180000 pesos.');
  assert.equal(quote.odontogram.length, 0);
  assert.equal(quote.budget.length, 1);
});

test('un implante automático rechazado se restituye y la relectura lo comprueba', () => {
  const before = emptyChart;
  const after = { teeth: { 36: 'Implante' }, surfaces: {}, missingReason: {}, crowns: {} };
  const actions = planChartWrites(7, before, after, []);
  assert.deepEqual(actions, [{ action: 'setToothStatus', patientId: 7, tooth: 36, status: 'Sin hallazgos' }]);
  const pending = verifyDictationSave({ patientId: 7, before, note: null, accepted: [], budgets: [] }, { notes: [], budgets: [], toothStatuses: { 7: after } });
  assert.equal(pending.ok, false);
  const restored = verifyDictationSave({ patientId: 7, before, note: null, accepted: [], budgets: [] }, { notes: [], budgets: [], toothStatuses: { 7: before } });
  assert.equal(restored.ok, true);
});
