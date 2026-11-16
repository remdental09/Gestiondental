import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildStamp, BUILD_TIME } from '../lib/build-info.ts';

test('la hora de actualización se muestra en hora de Chile (verano e invierno)', () => {
  assert.deepEqual(buildStamp('2026-11-16T18:12:00.000Z'), { day: '16 nov 2026', time: '15:12' }); // UTC-3
  assert.deepEqual(buildStamp('2026-07-01T16:05:00.000Z'), { day: '1 jul 2026', time: '12:05' }); // UTC-4
  assert.deepEqual(buildStamp('2026-12-31T02:59:00.000Z'), { day: '30 dic 2026', time: '23:59' });
});

test('sin fecha válida no se muestra nada', () => {
  assert.equal(buildStamp(''), null);
  assert.equal(buildStamp('no es fecha'), null);
  assert.equal(BUILD_TIME, ''); // en pruebas no hay compilación
});

test('la compilación define la hora y el encabezado la muestra arriba a la derecha', () => {
  assert.match(readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8'), /__BUILD_TIME__: JSON\.stringify\(new Date\(\)\.toISOString\(\)\)/);
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /data-testid="app-updated"/);
});
