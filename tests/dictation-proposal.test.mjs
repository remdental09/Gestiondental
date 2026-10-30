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

test('separa caries con ICDAS del estado general y conserva el relato', () => {
  const proposal = structureTranscript('El paciente refiere dolor al frío. Se observa caries en la cara oclusal de la pieza FDI 3.6, ICDAS 3, lesión activa. No se confirma diagnóstico de pulpitis.');
  assert.equal(proposal.odontogram.length, 1);
  assert.equal(proposal.odontogram[0].tooth, 36);
  assert.equal(proposal.odontogram[0].kind, 'surface');
  assert.equal(proposal.odontogram[0].surface, 'O');
  assert.deepEqual(proposal.odontogram[0].finding, { condition: 'caries', icdas: 3, activity: 'active' });
  assert.equal(proposal.odontogram.some((item) => item.kind !== 'surface'), false);
  assert.match(proposal.evolution.body, /refiere dolor al frío/i);
  assert.match(proposal.evolution.body, /Se observa caries/i);
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

test('pieza 36 sin sistema no se asume como FDI y la caries incompleta no se aplica', () => {
  const proposal = structureTranscript('Pieza 36 con caries.');
  assert.equal(proposal.odontogram.length, 0);
  assert.match(proposal.clarifications.join(' '), /no se asumió/i);
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

test('el JSON del modelo se valida y descarta pieza inválida, caries incompleta y sondaje persistido', () => {
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
  assert.equal(proposal.odontogram.length, 0);
  assert.equal(proposal.perio.length, 1);
  assert.equal(proposal.perio[0].persisted, false);
  assert.match(proposal.clarifications.join(' '), /no es un FDI válido/i);
  assert.match(proposal.clarifications.join(' '), /ICDAS/i);
  assert.match(proposal.clarifications.join(' '), /no se guarda/i);
});

test('sin Workers AI se usa el estructurador local y un modelo fallido no reemplaza la revisión', async () => {
  const local = await proposeFromTranscript({ transcript: 'Pieza 12 con obturación oclusal.', chart: [] }, null);
  assert.equal(local.engine, 'reglas-locales');
  assert.match(local.notice, /Workers AI no está enlazado/);
  assert.equal(local.proposal.odontogram[0].tooth, 24);

  const failed = await proposeFromTranscript({ transcript: 'Pieza 12 con obturación oclusal.', chart: [] }, {
    id: 'workers-ai',
    model: 'modelo-de-prueba',
    complete: async () => { throw new Error('sin cuota'); },
  });
  assert.equal(failed.engine, 'reglas-locales');
  assert.match(failed.notice, /estructurador local/);
  assert.equal(failed.proposal.odontogram[0].tooth, 24);

  const events = [];
  const accepted = await proposeFromTranscript({ transcript: 'Pieza 12 con obturación oclusal.', chart: [] }, {
    id: 'workers-ai',
    model: 'modelo-de-prueba',
    complete: async () => ({
      evolution: { title: 'Nota', body: 'Pieza 12 con obturación oclusal revisable.' },
      odontogram: [{ tooth: 11, numbering: 'FDI', numberingLabel: 'FDI 1.1', sourceText: 'modelo', kind: 'status', status: 'Ausente' }],
      budget: [],
      perio: [],
      clarifications: ['Revisar numeración.'],
    }),
  }, (event, detail) => events.push({ event, detail }));
  assert.equal(accepted.engine, 'workers-ai');
  assert.equal(accepted.model, 'modelo-de-prueba');
  assert.equal(accepted.notice, null);
  assert.equal(accepted.proposal.odontogram.some((item) => item.status === 'Ausente' || item.tooth === 11), false);
  assert.equal(accepted.proposal.odontogram[0].tooth, 24);
  assert.equal(accepted.proposal.odontogram[0].finding.condition, 'restored');
  assert.equal(events.some((item) => item.event === 'dictation.model_items_rejected'), false);
});

test('una corona inventada sobre caries y obturación no llega al odontograma', async () => {
  const transcript = 'Pieza 30 caries oclusal. Pieza 12 obturación oclusal de resina.';
  const local = structureTranscript(transcript);
  assert.equal(local.odontogram.some((item) => item.status === 'Corona' || item.kind === 'crown'), false);
  assert.equal(local.odontogram.find((item) => item.tooth === 24)?.finding.condition, 'restored');
  assert.equal(local.odontogram.some((item) => item.tooth === 36), false);
  assert.match(local.clarifications.join(' '), /ICDAS/i);

  const events = [];
  const outcome = await proposeFromTranscript({ transcript, chart: [] }, {
    id: 'workers-ai',
    model: '@cf/meta/llama-3.1-8b-instruct-fast',
    complete: async () => ({
      evolution: { title: 'Nota', body: 'Sin relación clínica.' },
      odontogram: [
        { tooth: 36, numbering: 'chilena', numberingLabel: 'nacional chilena 30', sourceText: 'Pieza 30 caries oclusal.', kind: 'crown', status: 'Corona' },
        { tooth: 24, numbering: 'chilena', numberingLabel: 'nacional chilena 12', sourceText: 'Pieza 12 obturación oclusal de resina.', kind: 'crown', status: 'Corona' },
      ],
      budget: [],
      perio: [],
      clarifications: [],
    }),
  }, (event, detail) => events.push({ event, detail }));
  assert.match(outcome.notice, /redacción local/);
  assert.equal(outcome.proposal.odontogram.some((item) => item.kind === 'crown' || item.status === 'Corona'), false);
  assert.equal(outcome.proposal.odontogram.find((item) => item.tooth === 24)?.finding.condition, 'restored');
  assert.equal(outcome.proposal.odontogram.some((item) => item.tooth === 36), false);
  assert.match(outcome.proposal.evolution.body, /obturación oclusal/i);
  assert.match(outcome.proposal.clarifications.join(' '), /ICDAS/i);
  assert.equal(events.some((item) => item.event === 'dictation.evolution_rejected'), true);
  assert.equal(JSON.stringify(events).includes(transcript), false);
});

test('el error 5025 queda en el registro y el dentista ve el aviso de respaldo', async () => {
  const events = [];
  const outcome = await proposeFromTranscript({ transcript: 'Pieza 12 con obturación oclusal.', chart: [] }, {
    id: 'workers-ai',
    model: '@cf/meta/llama-3.1-8b-instruct-fp8',
    complete: async () => { throw new Error('AiError: 5025: This model doesn\'t support JSON Schema.'); },
  }, (event, detail) => events.push({ event, detail }));
  assert.equal(outcome.engine, 'reglas-locales');
  assert.match(outcome.notice, /No se pudo usar el modelo/);
  assert.equal(outcome.proposal.odontogram[0].tooth, 24);
  assert.equal(events[0].event, 'dictation.workers_ai_failed');
  assert.match(events[0].detail.message, /5025/);
  assert.equal(Object.values(events[0].detail).join(' ').includes('obturación'), false);
});

test('un JSON compatible con caries ICDAS se conserva', async () => {
  const transcript = 'Se observa caries en la cara oclusal de la pieza FDI 3.6, ICDAS 3, lesión activa.';
  const outcome = await proposeFromTranscript({ transcript, chart: [] }, {
    id: 'workers-ai',
    model: '@cf/meta/llama-3.1-8b-instruct-fast',
    complete: async () => ({
      evolution: { title: 'Evolución dictada', body: 'Se observa caries en la cara oclusal de la pieza FDI 3.6, ICDAS 3, lesión activa.' },
      odontogram: [{ tooth: 36, numbering: 'FDI', numberingLabel: 'FDI 3.6', sourceText: transcript, kind: 'surface', surface: 'O', finding: { condition: 'caries', icdas: 3, activity: 'active' } }],
      budget: [],
      perio: [],
      clarifications: [],
    }),
  });
  assert.equal(outcome.notice, null);
  assert.equal(outcome.proposal.odontogram.length, 1);
  assert.equal(outcome.proposal.odontogram[0].tooth, 36);
  assert.deepEqual(outcome.proposal.odontogram[0].finding, { condition: 'caries', icdas: 3, activity: 'active' });
});

test('dictados chilenos de caries, sellado, sondaje, presupuesto y corona cementada', () => {
  const vestibular = structureTranscript('Se observa caries vestibular en FDI 1.6, ICDAS 2, inactiva.');
  assert.equal(vestibular.odontogram[0].tooth, 16);
  assert.equal(vestibular.odontogram[0].surface, 'V');
  assert.deepEqual(vestibular.odontogram[0].finding, { condition: 'caries', icdas: 2, activity: 'inactive' });

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
  assert.deepEqual(lesion.finding, { condition: 'caries', icdas: 3, activity: 'active' });
  assert.equal(filling.numberingLabel.includes('2.4'), true);
  assert.equal(filling.sourceText.includes('Pieza 12'), true);
  assert.equal(filling.sourceText.includes('Pieza 30'), false);
  assert.equal(filling.finding.condition, 'restored');
  assert.equal(/refiere|relata/i.test(first.proposal.evolution.body), false);
  assert.match(first.proposal.evolution.body, /Pieza 30 caries oclusal ICDAS 3 activa/);
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
