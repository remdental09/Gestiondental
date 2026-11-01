import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sanitizeDiagnosisTags, sameDiagnosisTags, MAX_DIAGNOSIS_TAGS } from '../lib/evolution-diagnoses.ts';

test('las etiquetas se validan contra el catálogo y el título sale del catálogo', () => {
  const ok = sanitizeDiagnosisTags([
    { code: 'DA09.70', title: 'inventado', tooth: 36, findings: ' dolor  a la percusión ', evidence: 'pieza 3.6 periodontitis apical sintomática', origin: 'ia', suggestedFrom: 'AAE' },
    { code: '', title: 'Periodontitis estadio III grado B (clasificación 2017)', tooth: null, origin: 'reglas' },
    { code: 'DA08.0&XA5B71', title: 'x', tooth: '46' },
  ]);
  assert.ok('tags' in ok);
  assert.equal(ok.tags.length, 3);
  assert.equal(ok.tags[0].title.startsWith('inventado'), false);
  assert.equal(ok.tags[0].findings, 'dolor a la percusión');
  assert.equal(ok.tags[0].suggestedFrom, 'AAE');
  assert.equal(ok.tags[1].code, '');
  assert.equal(ok.tags[2].tooth, 46);
  assert.equal(ok.tags[2].origin, 'manual');
});

test('rechaza códigos no guardables, piezas inválidas, sin nombre y exceso de etiquetas', () => {
  assert.ok('error' in sanitizeDiagnosisTags([{ code: 'DA09.6', title: 'Absceso' }]), 'categoría con subcódigos');
  assert.ok('error' in sanitizeDiagnosisTags([{ code: 'ZZ99', title: 'x' }]));
  assert.ok('error' in sanitizeDiagnosisTags([{ code: 'DA09.0', title: 'Pulpitis', tooth: 19 }]));
  assert.ok('error' in sanitizeDiagnosisTags([{ code: '', title: '  ' }]));
  assert.ok('error' in sanitizeDiagnosisTags('nada'));
  assert.ok('error' in sanitizeDiagnosisTags(Array.from({ length: MAX_DIAGNOSIS_TAGS + 1 }, () => ({ code: 'DA09.0' }))));
});

test('duplicados se eliminan y la relectura se compara sin importar el orden', () => {
  const parsed = sanitizeDiagnosisTags([{ code: 'DA09.0', tooth: 26 }, { code: 'DA09.0', tooth: 26 }, { code: 'DA09.0', tooth: 16 }]);
  assert.equal(parsed.tags.length, 2);
  assert.equal(sameDiagnosisTags(parsed.tags, [...parsed.tags].reverse()), true);
  assert.equal(sameDiagnosisTags(parsed.tags, parsed.tags.slice(1)), false);
  assert.equal(sameDiagnosisTags(parsed.tags, [{ ...parsed.tags[0], tooth: 27 }, parsed.tags[1]]), false);
});

test('migración nueva 0005 sin reescribir las aplicadas', () => {
  const sql = readFileSync(new URL('../drizzle/0005_evolution_diagnoses.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE `evolution_diagnoses`/);
  for (const col of ['code', 'title', 'tooth', 'findings', 'evidence', 'origin', 'suggested_from', 'evolution_id']) assert.match(sql, new RegExp('`' + col + '`'));
  const journal = JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'));
  assert.deepEqual(journal.entries.map((e) => e.tag).slice(-2), ['0004_payments', '0005_evolution_diagnoses']);
});
