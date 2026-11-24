import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildEvolutionLines, lineText, budgetItemsFor, refreshLine, pieceChips, sanitizeChips, inferZones, nextStatus, ALL_SEXTANTS, MOUTH, ARCHES, EVOLUTION_PIECES_DDL } from '../lib/evolution-lines.ts';
import { normalizeBudgetItems, itemStatus, withItemStatus } from '../lib/budget-plans.ts';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const item = (over) => ({ id: over.id ?? 'i1', tooth: 25, chile: null, surfaces: [], kind: 'realizado', category: 'obturacion', what: 'resina', evidence: '', origin: 'ia+reglas', ...over });

test('línea compacta «2.5 · Resina OD · ✓ realizado», verde y sin presupuesto abierto NO propone presupuestar', () => {
  const [line] = buildEvolutionLines({ items: [item({ surfaces: ['O', 'D'] })], budgets: [] });
  assert.equal(lineText(line), '2.5 · Resina OD · ✓ realizado');
  assert.equal(line.state, 'ok');
  assert.equal(line.code, '5005018');
  assert.equal(line.pendingBudget, false, 'lo realizado no cuenta como pendiente');
  assert.equal(line.canBudget, false, 'el dentista arma su propio presupuesto');
});

test('lo realizado avanza el ítem abierto de la misma pieza y prestación; los de etapas quedan Iniciados', () => {
  const budgets = [{ id: 7, title: 'Plan', items: [{ label: 'Resina 2.5', amount: 40000, teeth: [25] }, { label: 'Implante 3.6', amount: 900000, teeth: [36] }, { label: 'Corona 3.6', amount: 500000 }] }];
  const lines = buildEvolutionLines({ items: [item({}), item({ id: 'i2', tooth: 36, category: 'pilar', what: 'conexión del implante' })], budgets });
  const resina = lines.find(l => l.tooth === 25), implante = lines.find(l => l.tooth === 36);
  assert.deepEqual([resina.match.index, resina.match.to], [0, 'terminada']);
  assert.deepEqual([implante.match.index, implante.match.to], [1, 'iniciada']);
  assert.equal(nextStatus('corona', 'se cementa corona definitiva', 'iniciada'), 'terminada');
});

test('diagnóstico y plan nunca se marcan hechos; nunca propone presupuestar; con ítem → solo se muestra', () => {
  const budgets = [{ id: 3, title: 'P', items: [{ label: 'Endodoncia 4.6', amount: 1, teeth: [46] }] }];
  const lines = buildEvolutionLines({ items: [item({ id: 'a', tooth: 46, kind: 'diagnostico', category: 'lesion_apical', what: 'lesión apical' }), item({ id: 'b', tooth: 16, kind: 'diagnostico', category: 'caries', what: 'caries', surfaces: ['O'] }), item({ id: 'c', tooth: 17, kind: 'diagnostico', category: 'movilidad', what: 'movilidad' })], budgets });
  const a = lines.find(l => l.tooth === 46), b = lines.find(l => l.tooth === 16), c = lines.find(l => l.tooth === 17);
  assert.equal(a.match.to, a.match.from, 'no cambia el estado');
  assert.equal(a.pendingBudget, false);
  assert.equal(b.pendingBudget, false, 'no se propone presupuestar');
  assert.equal(b.canBudget, false);
  assert.equal(c.canBudget, false, 'movilidad no se presupuesta');
  const [budgetItem] = budgetItemsFor(b, { '5005017': 35000 }, '2026-11-20');
  assert.equal(budgetItem.amount, 35000);
  assert.equal(budgetItem.doneOn, undefined, 'un diagnóstico presupuestado queda Pendiente');
});

test('solo IA o varios ítems posibles → ámbar', () => {
  const budgets = [{ id: 1, title: 'A', items: [{ label: 'Resina 2.5', amount: 1, teeth: [25] }] }, { id: 2, title: 'B', items: [{ label: 'Resina 2.5 V', amount: 1, teeth: [25] }] }];
  const [amb] = buildEvolutionLines({ items: [item({})], budgets });
  assert.equal(amb.state, 'duda');
  assert.equal(amb.options.length, 2);
  const [ia] = buildEvolutionLines({ items: [item({ origin: 'ia' })], budgets: [] });
  assert.equal(ia.state, 'duda');
});

test('zona inferida: subgingival → sextantes, bitewing → arcadas, higiene → boca', () => {
  assert.deepEqual(inferZones('destartraje subgingival', [16, 17, 46], []).zones, ['perm:sext-1', 'perm:sext-4']);
  assert.deepEqual(inferZones('destartraje subgingival', [], []).zones, ALL_SEXTANTS);
  assert.ok(inferZones('pulido radicular', [], []).doubt);
  assert.deepEqual(inferZones('rx bitewing', [], []).zones, ARCHES);
  assert.deepEqual(inferZones('profilaxis e higiene', [], []).zones, [MOUTH]);
  assert.equal(inferZones('profilaxis e higiene', [], []).doubt, undefined, 'higiene sin alcance parcial no genera duda');
  // «sector» es parcial: no se afirma boca completa en silencio
  assert.ok(inferZones('destartraje en todo el sector', [36], []).doubt, '«todo el sector» marca duda');
  assert.equal(inferZones('destartraje en toda la boca', [], []).doubt, undefined, '«toda la boca» no genera duda');
  const lines = buildEvolutionLines({ items: [item({ id: 'x', tooth: 16, category: 'destartraje', what: 'destartraje subgingival' }), item({ id: 'y', tooth: 26, category: 'destartraje', what: 'destartraje subgingival' })], budgets: [] });
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0].zones, ['perm:sext-1', 'perm:sext-3']);
  assert.equal(budgetItemsFor(lines[0], {}, '2026-11-20').length, 2, 'un ítem por sextante');
});

test('sondaje dictado: mini resumen en la línea de la pieza o línea propia', () => {
  const perio = [{ id: 'p1', tooth: 16, site: 'MV', depth: 5, bleeding: true }, { id: 'p2', tooth: 16, site: 'DV', depth: 3 }, { id: 'p3', tooth: 21, site: 'V', depth: 4 }];
  const lines = buildEvolutionLines({ items: [item({ tooth: 16 })], perio, budgets: [] });
  assert.deepEqual(lines.find(l => l.tooth === 16).perio, { maxDepth: 5, sites: 2, bleeding: true, suppuration: false });
  assert.equal(lineText(lines.find(l => l.tooth === 21)), '2.1 · sondaje 4 mm');
});

test('corregir la pieza recalcula el calce', () => {
  const budgets = [{ id: 9, title: 'P', items: [{ label: 'Resina 2.4', amount: 1, teeth: [24] }] }];
  const [line] = buildEvolutionLines({ items: [item({})], budgets });
  assert.equal(line.match, undefined);
  const fixed = refreshLine({ ...line, tooth: 24 }, budgets);
  assert.equal(fixed.match.index, 0);
  assert.equal(fixed.canBudget, false);
});

test('ítem del presupuesto: estados Dentalsoft y migración al leer (pieza desde el nombre)', () => {
  const [old] = normalizeBudgetItems([{ label: 'Corona 3.6', amount: 1000 }]);
  assert.deepEqual(old.teeth, [36]);
  const started = withItemStatus(old, 'iniciada', '2026-11-01');
  assert.equal(itemStatus(started), 'iniciada');
  const done = withItemStatus(started, 'terminada', '2026-11-20');
  assert.deepEqual([itemStatus(done), done.startedOn, done.doneOn], ['terminada', '2026-11-01', '2026-11-20']);
  assert.equal(itemStatus(withItemStatus(done, 'pendiente', '2026-11-20')), 'pendiente');
  const [kept] = normalizeBudgetItems([{ label: 'Resina 2.7', amount: 1, teeth: [27], surfaces: ['o', 'm', 'x'], status: 'iniciada', startedOn: '2026-11-02' }]);
  assert.deepEqual(kept.surfaces, ['M', 'O']);
  assert.equal(kept.status, 'iniciada');
});

test('resumen mínimo bajo la evolución guardada', () => {
  const lines = buildEvolutionLines({ items: [item({})], budgets: [] });
  const chips = pieceChips(lines);
  assert.deepEqual(chips, [{ t: '2.5 Resina', s: 'ok' }]);
  assert.deepEqual(sanitizeChips([...chips, { t: 'x', s: 'malo' }, null]), chips);
  assert.match(EVOLUTION_PIECES_DDL, /^CREATE TABLE IF NOT EXISTS evolution_pieces/);
});

const actionBlock = (route, name) => {
  const start = route.indexOf(`action === "${name}"`);
  assert.ok(start > 0, name);
  const next = route.indexOf('if (action ===', start + 10);
  return route.slice(start, next > 0 ? next : undefined);
};

test('rutas nuevas: aislamiento por dueño, alternativas protegidas, sin borrar', () => {
  const route = read('app/api/clinical/route.ts');
  for (const name of ['setBudgetItemStatus', 'addBudgetItems', 'saveEvolutionPieces']) {
    const block = actionBlock(route, name);
    assert.match(block, /ownerId/);
    assert.doesNotMatch(block, /db\.delete\(|DROP|DELETE FROM/);
  }
  assert.match(actionBlock(route, 'setBudgetItemStatus'), /isAlternative/);
  assert.match(actionBlock(route, 'addBudgetItems'), /editable/);
  assert.match(actionBlock(route, 'saveEvolutionPieces'), /eq\(evolutions\.ownerId, ownerId\)/);
  assert.match(route, /evolution_pieces WHERE owner_id = \?/);
});

test('dictado: Guardar / Guardar y presupuestar (N) y líneas al pie de la evolución', () => {
  const ui = read('components/clinical-dictation.tsx');
  assert.match(ui, /Guardar y presupuestar \(\$\{budgetableSelected\}\)/);
  assert.match(ui, /Solo guardar/);
  assert.match(ui, /<EvolutionLinesBlock/);
  assert.match(ui, /line\.kind !== "realizado"/, 'solo lo realizado avanza ítems');
});

test('una pieza ausente solo se registra como diagnóstico: sin plan de endodoncia ni presupuesto', () => {
  const lines = buildEvolutionLines({ items: [item({ id: 'x', tooth: 18, kind: 'diagnostico', category: 'ausente', what: 'pieza ausente', surfaces: [] })], budgets: [] });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].kind, 'diagnostico');
  assert.notEqual(lines[0].category, 'endodoncia');
  assert.equal(lines[0].pendingBudget, false);
  assert.equal(lines[0].canBudget, false);
});
