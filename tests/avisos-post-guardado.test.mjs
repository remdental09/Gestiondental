import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../components/clinical-dictation.tsx', import.meta.url), 'utf8');
const block = source.slice(source.indexOf('setNotRecorded([\n        ...reviewWarnings,'), source.indexOf('if (!check.ok) setFormError'));

test('«Pendiente de revisión» tras guardar solo lista lo que quedó sin guardar', () => {
  assert.ok(block.length > 100, 'se encontró el bloque de avisos');
  for (const echo of ['— rechazado', 'sugerencia no confirmada', 'no se programó', 'no se agendó', 'no se registró', 'clarifications']) {
    assert.ok(!block.includes(echo), `no repite «${echo}»: lo rechazado a propósito y las preguntas ya mostradas no vuelven como alerta`);
  }
  assert.ok(block.includes('...reviewWarnings'), 'conserva los avisos de campos que fallaron');
  assert.ok(block.includes('incompleto'), 'conserva lo incompleto que no se pudo guardar');
});
