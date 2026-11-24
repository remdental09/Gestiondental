import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('cuando Drive confirma el respaldo, la ficha se relee para que «respaldo en Drive pendiente» se actualice sola', () => {
  const page = read('app/page.tsx');
  const start = page.indexOf('const onBackup=(event:Event)');
  assert.ok(start > 0, 'la página escucha el evento de respaldo');
  const listener = page.slice(start, start + 420);
  assert.ok(listener.includes('saved===true'), 'solo recarga con respaldo comprobado, nunca por un intento fallido');
  assert.ok(listener.includes('reloadAgendaRef.current()'), 'relee la ficha');
  assert.ok(listener.includes('removeEventListener("gestion-dental:drive-backup"'), 'limpia el oyente al desmontar');
});

test('el aviso «respaldo en Drive pendiente» sigue dependiendo del estado guardado, no de un supuesto', () => {
  assert.ok(read('components/evolution-history.tsx').includes('note.backupStatus === "not_configured"'));
});

test('tras un guardado limpio la hoja del dictado se cierra sola; con avisos pendientes no', () => {
  const dictation = read('components/clinical-dictation.tsx');
  assert.match(dictation, /const AUTO_CLOSE_MS = \d+;/);
  const start = dictation.indexOf('if (!open || !result?.ok || notRecorded.length > 0) return;');
  assert.ok(start > 0, 'solo se cierra con relectura confirmada (result.ok) y sin avisos (notRecorded vacío)');
  const effect = dictation.slice(start, start + 260);
  assert.ok(effect.includes('setTimeout(() => closeRef.current(), AUTO_CLOSE_MS)'));
  assert.ok(effect.includes('clearTimeout(timer)'), 'cancela el cierre si el estado cambia o se cierra a mano');
  assert.ok(dictation.includes('onClick={close}'), 'el botón Cerrar sigue disponible');
});
