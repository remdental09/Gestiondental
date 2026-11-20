import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cartola, freeOrder, splitAcross, sanitizeAllocations, PAYMENT_ALLOCATIONS_DDL } from '../lib/payment-allocation.ts';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const items = [
  { label: 'Resina 2.5', amount: 100, doneOn: '2026-11-05' },
  { label: 'Endodoncia 4.6', amount: 200, doneOn: '2026-11-01' },
  { label: 'Corona 4.6', amount: 300, status: 'iniciada', startedOn: '2026-11-06' },
  { label: 'Higiene', amount: 50 },
];

test('abono libre: primero lo realizado más antiguo, luego lo iniciado, luego lo pendiente', () => {
  assert.deepEqual(freeOrder(items), [1, 0, 2, 3]);
  const c = cartola(items, [{ id: 1, amount: 250, paidOn: '2026-11-07' }]);
  assert.deepEqual(c.items.map(i => i.paid), [50, 200, 0, 0]);
  assert.equal(c.realizado, 300);
  assert.equal(c.saldo, -50, 'negativo = por cobrar');
  assert.equal(c.pendiente, 400);
});

test('abono a ítems marcados: se respeta y el resto queda libre', () => {
  const before = cartola(items, []);
  const allocations = splitAcross(350, [2, 3], items, before);
  assert.deepEqual(allocations, [{ index: 2, label: 'Corona 4.6', amount: 300 }, { index: 3, label: 'Higiene', amount: 50 }]);
  const c = cartola(items, [{ id: 1, amount: 400, paidOn: '2026-11-07', allocations }]);
  assert.deepEqual(c.items.map(i => i.paid), [0, 50, 300, 50], 'los 50 sobrantes van a lo realizado más antiguo');
});

test('asignaciones siguen al ítem si el plan se reordena; validación del servidor', () => {
  const moved = [items[3], items[0], items[1], items[2]];
  const c = cartola(moved, [{ id: 1, amount: 300, allocations: [{ index: 2, label: 'Corona 4.6', amount: 300 }] }]);
  assert.equal(c.items[3].paid, 300);
  assert.deepEqual(sanitizeAllocations(undefined, items, 100), []);
  assert.equal(sanitizeAllocations([{ index: 9, amount: 1 }], items, 100), null);
  assert.equal(sanitizeAllocations([{ index: 0, amount: 101 }], items, 500), null, 'más que el ítem');
  assert.equal(sanitizeAllocations([{ index: 0, amount: 60 }, { index: 1, amount: 60 }], items, 100), null, 'más que el abono');
  assert.deepEqual(sanitizeAllocations([{ index: 1, amount: 60 }], items, 100), [{ index: 1, label: 'Endodoncia 4.6', amount: 60 }]);
});

test('ruta: tabla aditiva, aislamiento por dueño y vista de pagos con asignaciones', () => {
  assert.match(PAYMENT_ALLOCATIONS_DDL, /^CREATE TABLE IF NOT EXISTS payment_allocations/);
  const route = read('app/api/clinical/route.ts');
  assert.match(route, /FROM payment_allocations WHERE owner_id = \?/);
  assert.match(route, /INSERT INTO payment_allocations \(owner_id,/);
  assert.match(route, /sanitizeAllocations\(input\.allocations, budgetData\.items, amount\)/);
  assert.doesNotMatch(route, /DELETE FROM payment_allocations|DROP TABLE/);
  const dialog = read('components/budget-payment-dialog.tsx');
  assert.match(dialog, /Abono libre/);
  assert.match(dialog, /Ítems marcados/);
  assert.match(read('components/budget-plan.tsx'), /Tratamientos realizados/);
});
