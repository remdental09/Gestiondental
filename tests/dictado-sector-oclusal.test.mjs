import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeFromTranscript, resolveDictatedSurfaces } from '../lib/dictation/proposal.ts';
import { keepToothObservations } from '../lib/dictation/tooth-observation.ts';

// Dictado y respuesta del modelo simulados (sin datos de pacientes).
const faces = (text) => resolveDictatedSurfaces(text, 17).surfaces;

test('«oclusal hacia palatino / vestibular» es un sector de la cara oclusal', () => {
  assert.deepEqual(faces('Composite dividido en dos, en la cara oclusal hacia palatino y oclusal hacia vestibular.'), ['O']);
  assert.deepEqual(faces('Resina oclusal hacia palatino y hacia vestibular.'), ['O']);
  assert.deepEqual(faces('Resina oclusal hacia el lado distal.'), ['O']);
});

test('las caras compuestas, nombradas o por extensión se siguen marcando', () => {
  assert.deepEqual(faces('Resina ocluso-palatina.').sort(), ['O', 'P']);
  assert.deepEqual(faces('Resina oclusal y cara vestibular.').sort(), ['O', 'V']);
  assert.deepEqual(faces('Resina oclusal y palatina.').sort(), ['O', 'P']);
  assert.deepEqual(faces('Resina que va desde oclusal hacia vestibular.').sort(), ['O', 'V']);
  assert.deepEqual(faces('Resina desde la oclusal hacia vestibular.').sort(), ['O', 'V']);
});

const dictado = 'Pieza 3 con lesión inactiva, cubierta con ionómero. La pieza vital se encuentra en buenas condiciones sin dolor. Se desgasta parte del ionómero y se realiza una obturación de composite oclusal. Quedan dos sectores, oclusal hacia palatino y oclusal hacia vestibular. Paciente ha manifestado dolor, sin anestesia.';
const modelo = {
  nota: { motivo: '', anamnesis: 'Paciente ha manifestado dolor. Refiere que la pieza 3 se encuentra vital y sin dolor al momento de la evaluación.', alergias: '', medicamentos: '', examen: 'Se observa lesión inactiva en la pieza 3. La pieza vital se encuentra en buenas condiciones.', diagnostico: '', procedimientos: 'Se desgasta parte del ionómero de la pieza 3 y se realiza una obturación de composite oclusal. No se administra anestesia.', plan: '', indicaciones: '', presupuesto: '' },
  hallazgos: [{ pieza: '3', sistema: 'chilena', tipo: 'superficie', condicion: 'obturacion', estado: '', caras: ['O', 'V', 'P'], profundidad: '', evidencia: 'Quedan dos sectores, oclusal hacia palatino y oclusal hacia vestibular' }],
  procedimientos: [{ texto: 'Se desgasta parte del ionómero de la pieza 3.', evidencia: 'Se desgasta parte del ionómero', codigo: '' }],
  presupuesto: [], ficha: [], texto_corregido: dictado, periodonto: [], pagos: [], citas: [], diagnosticos: [], diagnosticos_sugeridos: [], dudas: [],
};

test('nota completa: solo O, sin frase repetida, la observación entera en Examen y aviso por el dolor', async () => {
  const { proposal, engine } = await proposeFromTranscript({ transcript: dictado, chart: [] }, { model: 'simulado', complete: async () => structuredClone(modelo) }, () => {}, { sensitivity: 'basic' });
  const body = proposal.evolution.body;
  assert.equal(engine, 'ia+reglas');
  assert.deepEqual(proposal.odontogram.map((item) => [item.tooth, item.surface]), [[16, 'O']]);
  assert.equal(body.match(/Se desgasta parte/g).length, 1);
  assert.equal(/Refiere/.test(body), false);
  assert.match(body, /Anamnesis y antecedentes\nPaciente ha manifestado dolor\.\n/);
  assert.match(body, /Examen\n.*La pieza vital se encuentra en buenas condiciones sin dolor\./);
  assert.equal(body.match(/vital/g).length, 1);
  assert.ok(proposal.clarifications.some((note) => note.includes('«sin dolor»')));
});

const nota = (anamnesis, examen) => ({ motivo: '', anamnesis, examen });

test('si el paciente lo refirió en el dictado, «Refiere» se respeta', () => {
  const value = nota('Refiere estar sin dolor.', 'La pieza vital se encuentra en buen estado.');
  keepToothObservations(value, 'Paciente refiere estar sin dolor. La pieza vital se encuentra en buen estado.');
  assert.equal(value.anamnesis, 'Refiere estar sin dolor.');
});

test('una nota ya correcta no cambia', () => {
  const value = nota('', 'La pieza 2 se encuentra vital, en buenas condiciones y sin dolor.');
  const before = structuredClone(value);
  assert.deepEqual(keepToothObservations(value, 'La pieza vital se encuentra en buenas condiciones sin dolor.'), []);
  assert.deepEqual(value, before);
});

test('con varias piezas, una frase sin número no mueve lo dicho de otra', () => {
  const value = nota('', 'La pieza 3 se encuentra sin dolor.');
  keepToothObservations(value, 'Pieza 3 sin dolor al morder. Pieza 2, caries. La pieza vital sin dolor.');
  assert.equal(value.examen, 'La pieza 3 se encuentra sin dolor.');
});

test('una atribución mezclada con otros datos no se reescribe: se avisa', () => {
  const value = nota('Refiere que la pieza 2 está vital desde el control de marzo.', '');
  const warnings = keepToothObservations(value, 'La pieza 2 vital.');
  assert.match(value.anamnesis, /control de marzo/);
  assert.ok(warnings.some((note) => note.includes('atribuye al paciente')));
});

test('un dolor negado no genera contradicción', () => {
  const warnings = keepToothObservations(nota('', ''), 'La pieza 2 sin dolor. La paciente no ha manifestado dolor.');
  assert.deepEqual(warnings, []);
});
