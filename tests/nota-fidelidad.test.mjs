import test from 'node:test';
import assert from 'node:assert/strict';
import { noteFidelity } from '../lib/dictation/note-fidelity.ts';

// Casos sintéticos: la nota redactada solo puede contener datos clínicos que el profesional dijo.
const kinds = (flags) => flags.map((flag) => `${flag.kind}:${flag.found}`);

test('una nota fiel, con el lenguaje pasado a clínico, no genera avisos', () => {
  const dictado = 'Anestesia a la 4.6, saqué la caries, puse adhesivo y resina A2 en oclusal y distal, ajusté la mordida y pulí.';
  const nota = 'Procedimientos realizados\nSe administra anestesia en la pieza 4.6. Se remueve el tejido cariado, se aplica adhesivo y se realiza restauración de resina compuesta color A2 en las caras oclusal y distal. Se efectúa ajuste oclusal y pulido de la restauración.';
  assert.deepEqual(noteFidelity(nota, [dictado]), []);
});

test('marca la pieza, el material, el fármaco y la dosis que no se dictaron', () => {
  const dictado = 'Obturación en la 3.6 cara oclusal con resina.';
  const nota = 'Se realiza restauración de resina compuesta en la cara oclusal de la pieza 3.6 y de la pieza 3.7 con base de vidrio ionómero. Se indica ibuprofeno 400 mg cada 8 horas por 3 días.';
  const found = kinds(noteFidelity(nota, [dictado]));
  assert.ok(found.includes('pieza:3.7'), found.join(' | '));
  assert.ok(found.some((item) => item.startsWith('material:') && /ion[oó]mero/.test(item)), found.join(' | '));
  assert.ok(found.includes('fármaco:ibuprofeno'), found.join(' | '));
  assert.ok(found.some((item) => item.startsWith('cifra:400')), found.join(' | '));
  assert.ok(!found.includes('pieza:3.6'));
});

test('pasos y frases de cierre agregados para «sonar profesional» se marcan', () => {
  const dictado = 'Resina en la 2.1 por vestibular.';
  const nota = 'Bajo aislamiento absoluto se realiza grabado ácido y restauración de resina en la cara vestibular de la pieza 2.1, con fotopolimerización. Paciente tolera bien el procedimiento, sin complicaciones.';
  const found = noteFidelity(nota, [dictado]).filter((flag) => flag.kind === 'paso').map((flag) => flag.found.toLowerCase());
  assert.ok(found.some((item) => item.startsWith('aislamiento')), found.join(' | '));
  assert.ok(found.some((item) => item.startsWith('grabado')), found.join(' | '));
  assert.ok(found.some((item) => item.startsWith('fotopolimeriz')), found.join(' | '));
  assert.ok(found.some((item) => item.startsWith('tolera')), found.join(' | '));
});

test('las caras dictadas como abreviatura y las piezas en numeración chilena cuentan como dichas', () => {
  const dictado = 'Pieza treinta, MOD con amalgama.';
  const nota = 'Se realiza restauración de amalgama en las caras mesial, oclusal y distal de la pieza 30 (nacional chilena 30 · FDI 3.6).';
  assert.deepEqual(noteFidelity(nota, [dictado]), []);
});

test('cifras dichas con palabras o con equivalencias de tiempo no se marcan', () => {
  const dictado = 'Lidocaína, un tubo y medio. Conductometría veintiuno milímetros. Control en una semana. Amoxicilina quinientos cada ocho horas.';
  const nota = 'Se administra lidocaína, 1,5 tubos. Longitud de trabajo 21 mm. Se indica amoxicilina 500 mg cada 8 horas. Control en 7 días.';
  assert.deepEqual(kinds(noteFidelity(nota, [dictado])), []);
});

test('las respuestas del profesional respaldan los datos que agregan', () => {
  const dictado = 'Resina en la 1.1.';
  const nota = 'Se realiza restauración de resina en la cara mesial de la pieza 1.1.';
  assert.deepEqual(kinds(noteFidelity(nota, [dictado])), ['cara:mesial']);
  assert.deepEqual(noteFidelity(nota, [dictado, 'Cara mesial']), []);
});

test('no revisa las secciones que arma la app ni la transcripción literal', () => {
  const dictado = 'Control de la 1.6, sin novedad.';
  const nota = 'Examen\nControl de la pieza 1.6 sin novedad.\n\nDiagnósticos (CIE-11)\nFDI 2.6: caries de dentina\n\nExamen (odontograma)\nFDI 2.7: obturación de amalgama oclusal\n\nTranscripción completa\npieza 4.8 con lidocaína';
  assert.deepEqual(noteFidelity(nota, [dictado]), []);
});

test('el color no dictado se marca; el dictado no', () => {
  assert.deepEqual(kinds(noteFidelity('Resina color A3 en la pieza 1.1.', ['Resina A2 en la 1.1.'])), ['color:A3']);
  assert.deepEqual(noteFidelity('Resina color A2 en la pieza 1.1.', ['Resina A2 en la 1.1.']), []);
});
