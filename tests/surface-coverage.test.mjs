import test from 'node:test';
import assert from 'node:assert/strict';
import { chileToFdi, formatFdi, planChartWrites, structureTranscript } from '../lib/dictation/proposal.ts';
import { surfaceScreenSide } from '../app/odontogram-surface.ts';

const permanent = [];
for (let quadrant = 1; quadrant <= 4; quadrant += 1) {
  for (let position = 1; position <= 8; position += 1) permanent.push(quadrant * 10 + position);
}
const chileOf = Object.fromEntries(Array.from({ length: 32 }, (_, index) => [chileToFdi(index + 1), index + 1]));

function canonicalSurfaces(tooth) {
  const anterior = tooth % 10 <= 3;
  const upper = Math.floor(tooth / 10) <= 2;
  return [
    [anterior ? 'incisal' : 'oclusal', 'O'],
    ['vestibular', 'V'],
    ['mesial', 'M'],
    ['distal', 'D'],
    [upper ? 'palatina' : 'lingual', 'P'],
  ];
}

test('las 32 piezas permanentes aceptan cada cara válida en chilena y en FDI', () => {
  for (const tooth of permanent) {
    for (const [word, surface] of canonicalSurfaces(tooth)) {
      const chile = `Caries ${word} en pieza ${chileOf[tooth]}, ICDAS 2, activa.`;
      const fdi = `Caries ${word} en pieza ${formatFdi(tooth)}, ICDAS 2, activa.`;
      for (const phrase of [chile, fdi]) {
        const proposal = structureTranscript(phrase);
        const hits = proposal.odontogram.filter((item) => item.tooth === tooth && item.surface === surface);
        assert.equal(hits.length, 1, phrase);
        assert.equal(hits[0].finding.condition, 'caries');
        assert.equal(hits[0].finding.icdas, 2);
        assert.equal(hits[0].finding.activity, 'active');
        assert.equal(hits[0].sourceText.toLowerCase().includes(word), true, phrase);
      }
    }
  }
});

test('abreviaturas, compuestos y las tres formas de decir FDI 3.6', () => {
  const mod = structureTranscript('Caries MOD en pieza 30, ICDAS 4, activa.');
  assert.deepEqual(mod.odontogram.map((item) => item.surface).sort(), ['D', 'M', 'O']);
  assert.equal(new Set(mod.odontogram.map((item) => item.tooth)).size, 1);
  assert.equal(mod.odontogram[0].tooth, 36);
  assert.equal(mod.odontogram.every((item) => item.sourceText.includes('Pieza 30') || item.sourceText.includes('pieza 30')), true);

  const compounds = structureTranscript('Caries mesio-oclusal y ocluso-distal en pieza 30, ICDAS 2, activa.');
  assert.deepEqual(compounds.odontogram.map((item) => item.surface).sort(), ['D', 'M', 'O']);

  const words = structureTranscript('Caries en cara mesial y distal de la pieza 14, ICDAS 2, activa.');
  assert.deepEqual(words.odontogram.map((item) => item.surface).sort(), ['D', 'M']);
  assert.equal(words.odontogram[0].tooth, chileToFdi(14));

  for (const phrase of [
    'Caries oclusal en pieza 30, ICDAS 2, activa.',
    'Caries oclusal en pieza 3.6, ICDAS 2, activa.',
    'Caries oclusal en pieza tres seis, ICDAS 2, activa.',
    'Caries oclusal en FDI 36, ICDAS 2, activa.',
    'Caries oclusal en FDI treinta y seis, ICDAS 2, activa.',
  ]) {
    const proposal = structureTranscript(phrase);
    assert.deepEqual(proposal.odontogram.map((item) => item.tooth), [36], phrase);
    assert.equal(proposal.odontogram[0].surface, 'O');
  }

  const buccal = structureTranscript('Caries bucal en FDI 1.1, ICDAS 2, activa.');
  assert.equal(buccal.odontogram[0].tooth, 11);
  assert.equal(buccal.odontogram[0].surface, 'V');
  const actions = planChartWrites(1, { teeth: {}, surfaces: {} }, { teeth: {}, surfaces: {} }, mod.odontogram);
  assert.deepEqual(actions.map((action) => action.surface).sort(), ['D', 'M', 'O']);
});

test('un desajuste de cara se explica y la incisal posterior no se adivina', () => {
  const anteriorOcclusal = structureTranscript('Caries oclusal en FDI 1.1, ICDAS 2, activa.');
  assert.equal(anteriorOcclusal.odontogram[0].tooth, 11);
  assert.equal(anteriorOcclusal.odontogram[0].surface, 'O');
  assert.match(anteriorOcclusal.clarifications.join(' '), /incisal/);

  const posteriorIncisal = structureTranscript('Caries incisal en pieza 30, ICDAS 2, activa.');
  assert.equal(posteriorIncisal.odontogram.length, 0);
  assert.match(posteriorIncisal.clarifications.join(' '), /no corresponde a una pieza posterior/);

  const palatalBelow = structureTranscript('Caries palatina en pieza 30, ICDAS 2, activa.');
  assert.equal(palatalBelow.odontogram[0].tooth, 36);
  assert.equal(palatalBelow.odontogram[0].surface, 'P');
  assert.match(palatalBelow.clarifications.join(' '), /lingual/);

  const lingualAbove = structureTranscript('Caries lingual en FDI 2.1, ICDAS 2, activa.');
  assert.equal(lingualAbove.odontogram[0].tooth, 21);
  assert.equal(lingualAbove.odontogram[0].surface, 'P');
  assert.match(lingualAbove.clarifications.join(' '), /palatina/);
});

test('mesial mira a la línea media y vestibular es la cara externa en los cuatro cuadrantes', () => {
  for (const tooth of permanent) {
    const quadrant = Math.floor(tooth / 10);
    const mesialRight = quadrant === 1 || quadrant === 4;
    assert.equal(surfaceScreenSide(tooth, 'M'), mesialRight ? 'right' : 'left', `mesial ${tooth}`);
    assert.equal(surfaceScreenSide(tooth, 'D'), mesialRight ? 'left' : 'right', `distal ${tooth}`);
    assert.equal(surfaceScreenSide(tooth, 'V'), quadrant >= 3 ? 'bottom' : 'top', `vestibular ${tooth}`);
    assert.equal(surfaceScreenSide(tooth, 'P'), quadrant >= 3 ? 'top' : 'bottom', `interna ${tooth}`);
    assert.equal(surfaceScreenSide(tooth, 'O'), 'center');
  }
  assert.equal(surfaceScreenSide(55, 'M'), 'right');
  assert.equal(surfaceScreenSide(65, 'M'), 'left');
  assert.equal(surfaceScreenSide(85, 'V'), 'bottom');
  assert.equal(surfaceScreenSide(75, 'P'), 'top');
});
