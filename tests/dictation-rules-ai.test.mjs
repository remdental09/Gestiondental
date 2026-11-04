import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_SYSTEM_PROMPT,
  finalizeEvolution,
  planFichaUpdate,
  structureTranscript,
  validateAiExtraction,
  EXAM_REGISTRY_HEADER,
} from '../lib/dictation/proposal.ts';
import { createWebSpeechTranscription } from '../lib/dictation/transcription.ts';

const pick = (proposal) => proposal.odontogram.map((item) => [item.tooth, item.kind === 'surface' ? `${item.surface}:${item.finding.condition}` : item.status]);

test('el prompt clínico comparte las reglas de formato de identidad', () => {
  assert.match(AI_SYSTEM_PROMPT, /Normalización de identidad/);
  assert.match(AI_SYSTEM_PROMPT, /fecha de nacimiento/);
  assert.match(AI_SYSTEM_PROMPT, /no elijas un año/);
});

test('pieza 30 con obturación oclusal pieza 19 ausente se separa sin puntuación', () => {
  const proposal = structureTranscript('pieza 30 con obturación oclusal pieza 19 ausente');
  assert.deepEqual(pick(proposal), [[36, 'O:restored'], [46, 'Ausente']]);
  assert.equal(proposal.odontogram[0].sourceText.includes('19'), false);
  assert.equal(proposal.odontogram[1].sourceText.includes('30'), false);
  assert.equal(proposal.odontogram.every((item) => item.origin === 'reglas'), true);
});

test('«punto» dictado separa frases y no rompe «punto de contacto» ni FDI 3 punto 6', () => {
  const proposal = structureTranscript('pieza 12 obturación mesial punto pieza 30 sellante oclusal punto aparte FDI 1 punto 6 ausente');
  assert.deepEqual(pick(proposal), [[24, 'M:restored'], [36, 'O:sealant'], [16, 'Ausente']]);
});

test('la fractura de cúspide no genera caries ni presta sus caras a la obturación', () => {
  const proposal = structureTranscript('Pieza 3 con fractura de la cúspide mesiopalatina y obturación oclusal de amalgama.');
  assert.deepEqual(pick(proposal), [[16, 'O:restored']]);
  assert.equal(proposal.odontogram.some((item) => item.finding?.condition === 'caries'), false);
  assert.match(proposal.evolution.body, /Otros hallazgos del examen\nPieza 3 con fractura de la cúspide mesiopalatina/);
});

test('una caries sin profundidad entra al odontograma y la profundidad se pregunta como opcional', () => {
  const proposal = structureTranscript('pieza 30 caries distal pieza 12 caries oclusal de esmalte');
  assert.deepEqual(pick(proposal), [[36, 'D:caries'], [24, 'O:caries']]);
  assert.deepEqual(proposal.odontogram.map((item) => item.finding.depth), [null, 'esmalte']);
  assert.equal(proposal.incomplete.length, 0);
  const asks = proposal.clarifications.join('\n');
  assert.match(asks, /FDI 3\.6: ¿profundidad de la caries .*\? Opcional: «pieza 30 caries distal»/);
  assert.equal(/FDI 2\.4/.test(asks), false);
  // La pregunta opcional no queda como «Pendiente de aclarar» en la nota.
  assert.equal(/Pendiente de aclarar/.test(proposal.evolution.body), false);
});

test('alergias, antecedentes y medicamentos van a la ficha y no al odontograma', () => {
  const proposal = structureTranscript('Alérgico a la penicilina. Hipertenso en tratamiento. Toma losartán 50 mg. Pieza 8 obturación palatina.');
  assert.deepEqual(proposal.ficha.map((item) => item.field), ['allergies', 'history', 'medications']);
  assert.deepEqual(pick(proposal), [[11, 'P:restored']]);
  const update = planFichaUpdate({ allergies: 'Sin registrar', history: 'Asma.' }, proposal.ficha);
  assert.equal(update.allergies, 'Alérgico a la penicilina.');
  assert.match(update.history, /^Asma\. Hipertenso en tratamiento\. Medicamentos: Toma losartán 50 mg\.$/);
  assert.equal(planFichaUpdate({ allergies: 'Alérgico a la penicilina.', history: '' }, proposal.ficha.slice(0, 1)), null);
});

test('al guardar, el registro del odontograma se rehace con lo aceptado y no agrega el dictado original', () => {
  const transcript = 'pieza 30 con obturación oclusal pieza 19 ausente';
  const proposal = structureTranscript(transcript);
  const edited = `Motivo de consulta\nControl.\n\n${EXAM_REGISTRY_HEADER}\nFDI 9.9: texto viejo.\n\nIndicaciones\nControl en 6 meses.`;
  const body = finalizeEvolution(edited, proposal.odontogram.slice(0, 1), []);
  assert.match(body, /Examen \(odontograma\)\nFDI 3\.6 \(Chile 30\): obturación oclusal\./);
  assert.equal(body.includes('9.9'), false);
  assert.equal(body.includes('FDI 4.6'), false);
  assert.match(body, /Indicaciones\nControl en 6 meses\./);
  assert.equal(body.includes(transcript), false);
  // Idempotente: guardar dos veces no cambia la nota ni agrega el dictado.
  const again = finalizeEvolution(body, proposal.odontogram.slice(0, 1), []);
  assert.equal(again, body);
});

test('la cita de la IA tiene que estar en el dictado, incluso sin puntuación', () => {
  const transcript = 'paciente niega alergias pieza 8 caries palatina ICDAS 5 activa con compromiso pulpar punto plan endodoncia';
  const nota = { motivo: '', anamnesis: '', alergias: 'Niega alergias.', medicamentos: '', examen: 'Pieza 8 con caries palatina ICDAS 5 activa.', diagnostico: '', procedimientos: '', plan: 'Endodoncia de pieza 8.', indicaciones: '', presupuesto: '' };
  const ai = validateAiExtraction({
    nota,
    hallazgos: [
      { pieza: '8', sistema: 'chilena', tipo: 'superficie', condicion: 'caries', estado: '', caras: ['P'], icdas: 5, actividad: 'activa', material: '', color: '', evidencia: 'Pieza 8, caries palatina, ICDAS 5 activa' },
      { pieza: '9', sistema: 'chilena', tipo: 'estado', estado: 'Ausente', condicion: '', caras: [], icdas: 0, actividad: '', material: '', color: '', evidencia: 'pieza 9 ausente' },
    ],
    procedimientos: [{ texto: 'Endodoncia pieza 8', evidencia: 'se realizó endodoncia' }],
    presupuesto: [],
    ficha: [{ campo: 'alergias', texto: 'Niega alergias', evidencia: 'niega alergias' }],
    dudas: ['pieza 8 sin sistema de numeración'],
  }, transcript);
  assert.deepEqual(ai.odontogram.map((item) => [item.tooth, item.surface, item.finding.icdas, item.finding.activity]), [[11, 'P', 5, 'active']]);
  assert.equal(ai.rejected >= 1, true);
  assert.match(ai.clarifications.join(' '), /pieza 9|cita/i);
  assert.equal(ai.procedures[0].verified, false);
  assert.equal(ai.ficha[0].field, 'allergies');
  assert.equal(ai.clarifications.some((note) => /sistema de numeración/.test(note)), false);
  assert.match(ai.noteBody, /^Alergias\nNiega alergias\./);
});

test('en iPhone el reconocimiento se reabre tras un silencio hasta que se detiene', () => {
  const created = [];
  class FakeRecognition {
    constructor() { created.push(this); }
    start() {}
    stop() { this.onend?.(); }
    abort() {}
  }
  globalThis.window = { SpeechRecognition: FakeRecognition };
  try {
    const engine = createWebSpeechTranscription();
    const seen = [];
    let ended = 0;
    engine.start('', { onTranscript: (text) => seen.push(text), onError: () => {}, onEnd: () => { ended += 1; } });
    created[0].onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'pieza 30' } }] });
    created[0].onerror({ error: 'no-speech' });
    created[0].onend();
    assert.equal(created.length, 2, 'se reabre tras el corte');
    assert.equal(ended, 0);
    created[1].onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'obturación oclusal' } }] });
    assert.equal(seen.at(-1), 'pieza 30 obturación oclusal');
    engine.stop();
    assert.equal(created.length, 2, 'Detener no reabre');
    assert.equal(ended, 1);
  } finally {
    delete globalThis.window;
  }
});
