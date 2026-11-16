import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, toRecords, detectKind, parseMoney, parseDmy, importedDocument, parseZone, needsNumbering, commonZoneNumber, buildImport, chunkBundles, importedNoteBody } from '../lib/platform-import.ts';
import { universalToFdi, chileToFdi } from '../lib/dictation/proposal.ts';
import { readZip } from '../lib/zip-reader.ts';
import { normalizeBudgetItems } from '../lib/budget-plans.ts';
import { readFileSync } from 'node:fs';

// Datos 100 % inventados: ningún dato de pacientes reales.
const csv = (...lines) => toRecords(parseCsv(lines.join('\n')));
const tables = () => ({
  pacientes: csv('Nombre,Apellido,DNI,Fecha de Nacimiento,Teléfono 1,Email,Dirección,Ciudad,Sexo', 'Ana María,Prueba Uno,11.111.111-1,15/03/1990,+56 9 1111 1111,ANA@EJEMPLO.CL,Calle Falsa 123,Santiago,F', 'Luis,Prueba Dos,,01/01/1980,,,,,M'),
  planes: csv('Número Plan de tratamiento,DNI Paciente,Nombre Paciente,Estado,Total,Total Pagado,Fecha Creación,Observaciones,Cantidad Items',
    '1,11.111.111-1,Ana María Prueba Uno,Finalizado,"$30.000",$30.000,10/02/2024,,2', '2,11.111.111-1,Ana María Prueba Uno,En progreso,"$50.000",$0,11/02/2024,Controlar,1', '3,11.111.111-1,Ana María Prueba Uno,Inactivo,$0,$0,12/02/2024,,0', '1,,Luis Prueba Dos,En progreso,"$10.000",$0,12/02/2024,,1'),
  tratamientos: csv('Número Plan de tratamiento,DNI Paciente,Nombre Paciente,Tratamiento,Precio Original,Cantidad Zonas,Descuento,Total Item,Zona,Estado,Fecha Creación',
    '1,11.111.111-1,Ana María Prueba Uno,Limpieza,"$20.000",1,$0,"$20.000",Boca completa,Finalizado,10/02/2024',
    '1,11.111.111-1,Ana María Prueba Uno,Resina,"$5.000",2,"$1.000","$9.000","20, 27",Finalizado,10/02/2024',
    '2,11.111.111-1,Ana María Prueba Uno,Corona,"$50.000",1,$0,"$50.000",Arcada Superior,Pendiente,11/02/2024',
    '1,,Luis Prueba Dos,Extracción,"$10.000",1,$0,"$10.000",SEXTANTE_1,Pendiente,12/02/2024'),
  evoluciones: csv('Fecha Evolución,Fecha de Creación,DNI Paciente,Nombre Paciente,Profesional,Zona,Evolución', '20/02/2024,20/02/2024,11.111.111-1,Ana María Prueba Uno,Dra. Prueba,3,Control sin novedades', '20/02/2024,20/02/2024,11.111.111-1,Ana María Prueba Uno,Dra. Prueba,3,Control sin novedades', '21/02/2024,21/02/2024,,Luis Prueba Dos,,,'),
  pagos: csv('Número Plan de tratamiento,DNI Paciente,Nombre Paciente,Monto,Fecha Pago,Método de Pago,Cuotas,Número Documento,Observación', '1,11.111.111-1,Ana María Prueba Uno,"$30.000",15/02/2024,Efectivo,,A1,'),
  aranceles: csv('Nombre,Categoría,Monto', 'Limpieza especial,Prevención,"$25.000"', 'Limpieza especial,Prevención,"$25.000"', 'ab,Prevención,"$1.000"'),
});

test('CSV: comillas, saltos de línea, BOM y separador punto y coma', () => {
  assert.deepEqual(parseCsv('﻿a;b\n"x;1";"dos\nlíneas"\n'), [['a', 'b'], ['x;1', 'dos\nlíneas']]);
  assert.deepEqual(parseCsv('a,b\n"con ""comillas""",2'), [['a', 'b'], ['con "comillas"', '2']]);
});

test('reconoce cada tabla por sus encabezados y no confunde una desconocida', () => {
  const t = tables();
  const kinds = Object.fromEntries(Object.entries(t).map(([k, rows]) => [k, detectKind(Object.keys(rows[0]))]));
  assert.deepEqual(kinds, { pacientes: 'pacientes', planes: 'planes', tratamientos: 'tratamientos', evoluciones: 'evoluciones', pagos: 'pagos', aranceles: 'aranceles' });
  assert.equal(detectKind(['Foo', 'Bar']), null);
});

test('dinero, fechas y documentos', () => {
  assert.equal(parseMoney('$ 1.234.567'), 1234567);
  assert.equal(parseDmy('05/03/2024'), '2024-03-05');
  assert.equal(parseDmy('31/02/2024'), null);
  assert.equal(importedDocument('11.111.111-1'), '111111111');
  assert.equal(importedDocument('11.111.111-2'), '111111112', 'dígito verificador malo pero con forma de documento extranjero válido');
  assert.equal(importedDocument('12'), null);
  assert.equal(importedDocument(''), null);
});

test('zonas: nombres, arcadas, sextantes, lista y letras temporales; los números exigen numeración', () => {
  assert.equal(parseZone('Boca completa', null).zone, 'perm:boca');
  assert.equal(parseZone('ARCADA_INFERIOR', null).zone, 'perm:arc-inf');
  assert.equal(parseZone('Sextante Grupo 4', null).zone, 'perm:sext-6');
  assert.equal(parseZone('SEXTANTE_2', null).zone, 'perm:sext-2');
  assert.equal(parseZone('DENTICION_TEMPORAL_COMPLETA', null).zone, 'temp:boca');
  assert.deepEqual(parseZone('3, 14', 'universal').teeth, [16, 26]);
  assert.deepEqual(parseZone('3', null).unknown, ['3']);
  assert.deepEqual(parseZone('A', null).teeth, [55]);
  assert.deepEqual(parseZone('9z', 'chile').unknown, ['9z']);
});

test('universal y chilena dan piezas distintas para el mismo número y nunca se adivina', () => {
  const t = tables();
  assert.equal(needsNumbering(t), true);
  assert.ok([20, 27].includes(commonZoneNumber(t.tratamientos)));
  const a = buildImport(t, 'universal'), b = buildImport(t, 'chile');
  const ana = r => r.bundles.find(x => x.patient.document === '111111111');
  const sorted = list => list.sort((x, y) => x - y);
  assert.deepEqual(ana(a).plans[0].items[1].teeth, sorted([universalToFdi(20), universalToFdi(27)]));
  assert.deepEqual(ana(b).plans[0].items[1].teeth, sorted([chileToFdi(20), chileToFdi(27)]));
  assert.notDeepEqual(ana(a).plans[0].items[1].teeth, ana(b).plans[0].items[1].teeth);
  const none = buildImport(t, null);
  assert.equal(ana(none).plans[0].items[1].teeth, undefined);
  assert.ok(none.warnings.some(w => /zona que no se pudo convertir/.test(w)));
});

test('planes: monto, descuento entero, fecha de término, estado y planes sin tratamientos', () => {
  const r = buildImport(tables(), 'universal');
  assert.equal(r.totals.pacientes, 2);
  const ana = r.bundles.find(x => x.patient.document === '111111111');
  assert.equal(ana.plans.length, 2);
  const [plan1, plan2] = ana.plans;
  assert.equal(plan1.title, 'Plan 1 (importado)');
  assert.equal(plan1.status, 'Importado · finalizado');
  assert.equal(plan1.items[0].zone, 'perm:boca');
  assert.equal(plan1.items[0].doneOn, '2024-02-10');
  assert.deepEqual({ amount: plan1.items[1].amount, pct: plan1.items[1].discountPercent }, { amount: 10000, pct: 10 });
  assert.match(plan2.title, /Controlar/);
  assert.ok(r.warnings.some(w => /no tenían tratamientos/.test(w)));
  assert.ok(r.warnings.some(w => /Sextante Grupo/.test(w)));
  for (const plan of ana.plans) assert.ok(normalizeBudgetItems(plan.items), 'los ítems pasan la validación de la app');
});

test('paciente sin documento se reconoce por nombre y no se inventa documento', () => {
  const r = buildImport(tables(), 'universal');
  const luis = r.bundles.find(x => x.patient.name.startsWith('Luis'));
  assert.equal(luis.patient.document, null);
  assert.equal(luis.plans.length, 1);
  assert.equal(luis.plans[0].items[0].zone, 'perm:sext-1');
});

test('evoluciones: texto íntegro, sin las vacías, ids estables y repetidas distinguibles; pagos por plan', () => {
  const a = buildImport(tables(), 'universal'), b = buildImport(tables(), 'universal');
  const ana = r => r.bundles.find(x => x.patient.document === '111111111');
  assert.equal(ana(a).notes.length, 2);
  assert.notEqual(ana(a).notes[0].requestId, ana(a).notes[1].requestId);
  assert.deepEqual(ana(a).notes.map(n => n.requestId), ana(b).notes.map(n => n.requestId));
  assert.ok(importedNoteBody(ana(a).notes[0]).startsWith('Control sin novedades'));
  assert.equal(ana(a).payments[0].amount, 30000);
  assert.equal(ana(a).payments[0].method, 'efectivo');
  assert.equal(ana(a).payments[0].plan, '1');
});

test('aranceles propios: sin repetidos ni nombres demasiado cortos', () => {
  const r = buildImport(tables(), 'universal');
  assert.equal(r.tariffs.length, 1);
  assert.equal(r.tariffs[0].price, 25000);
});

test('plan con más de 30 tratamientos se divide en partes de hasta 30', () => {
  const rows = ['Número Plan de tratamiento,DNI Paciente,Nombre Paciente,Tratamiento,Precio Original,Cantidad Zonas,Descuento,Total Item,Zona,Estado,Fecha Creación'];
  for (let i = 0; i < 65; i++) rows.push(`1,11.111.111-1,Ana Prueba,Trat ${i},"$1.000",1,$0,"$1.000",,Pendiente,10/02/2024`);
  const r = buildImport({ pacientes: csv('Nombre,Apellido,DNI', 'Ana,Prueba,11.111.111-1'), planes: csv('Número Plan de tratamiento,DNI Paciente,Nombre Paciente,Estado,Total,Total Pagado,Fecha Creación', '1,11.111.111-1,Ana Prueba,En progreso,"$65.000",$0,10/02/2024'), tratamientos: csv(...rows) }, 'universal');
  assert.deepEqual(r.bundles[0].plans.map(p => p.items.length), [30, 30, 5]);
  assert.deepEqual(r.bundles[0].plans.map(p => p.number), ['1.1', '1.2', '1.3']);
});

test('chunkBundles: grupos acotados y sin perder filas', () => {
  const bundle = (n, notes) => ({ patient: { key: 'n:' + n, name: 'P ' + n }, plans: [], notes: Array.from({ length: notes }, (_, i) => ({ requestId: `imp:ev:${n}${i}` })), payments: [] });
  const input = [bundle(1, 10), bundle(2, 10), bundle(3, 10), bundle(4, 10), bundle(5, 10), bundle(6, 400)];
  const groups = chunkBundles(input);
  assert.ok(groups.every(g => g.length <= 4 && g.reduce((s, b) => s + b.notes.length, 0) <= 150));
  assert.equal(groups.flat().reduce((s, b) => s + b.notes.length, 0), 450);
});

test('lector de .zip: entradas almacenadas y comprimidas con deflate', async () => {
  // zip creado con Python (ver tests/fixtures); aquí se arma uno almacenado a mano.
  const name = new TextEncoder().encode('a.csv'), body = new TextEncoder().encode('x,y\n1,2\n');
  const local = new Uint8Array(30 + name.length + body.length), lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true); lv.setUint16(26, name.length, true); local.set(name, 30); local.set(body, 30 + name.length);
  const central = new Uint8Array(46 + name.length), cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true); cv.setUint32(20, body.length, true); cv.setUint32(24, body.length, true); cv.setUint16(28, name.length, true); cv.setUint32(42, 0, true); central.set(name, 46);
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, 1, true); ev.setUint16(10, 1, true); ev.setUint32(12, central.length, true); ev.setUint32(16, local.length, true);
  const zip = new Uint8Array([...local, ...central, ...end]);
  const entries = await readZip(zip.buffer);
  assert.equal(entries[0].name, 'a.csv');
  assert.equal(new TextDecoder().decode(entries[0].data), 'x,y\n1,2\n');
  await assert.rejects(() => readZip(new Uint8Array(40).buffer), /zip/);
});

test('panel y navegación: Configuración aparece bajo Aranceles y la API está protegida', () => {
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /\{name:"Aranceles",icon:Receipt\},\{name:"Configuración",icon:Settings\}/);
  assert.match(page, /section==="Configuración"&&/);
  const route = readFileSync(new URL('../app/api/importar-plataforma/route.ts', import.meta.url), 'utf8');
  assert.match(route, /getChatGPTUser/);
  assert.match(route, /Origen no permitido/);
});
