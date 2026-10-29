import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRecords, ClinicalImportError } from '../app/clinical-import-validation.ts';

const record = () => ({
  name: 'Paciente María de Prueba', birthDate: '', reason: '', history: '', allergies: '',
  driveFolderId: 'synthetic_folder_0001',
  notes: [{ clinicalDate: '', title: 'Registro de prueba', body: 'Texto original.\nFecha de atención no informada.', sourceDocumentId: 'synthetic_document_0001' }],
});

test('conserva texto y fechas desconocidas sin asignar hoy', () => {
  const input = record();
  const [result] = parseRecords([input]);
  assert.equal(result.birthDate, '');
  assert.equal(result.notes[0].clinicalDate, '');
  assert.equal(result.notes[0].body, input.notes[0].body);
});
test('rechaza una fecha imposible', () => {
  const input = record(); input.notes[0].clinicalDate = '2026-02-30';
  assert.throws(() => parseRecords([input]), ClinicalImportError);
});
test('acepta fecha clínica válida con nacimiento desconocido', () => {
  const input = record(); input.notes[0].clinicalDate = '2026-10-14';
  assert.equal(parseRecords([input])[0].notes[0].clinicalDate, '2026-10-14');
});
test('frena carpetas duplicadas antes de escribir', () => {
  assert.throws(() => parseRecords([record(), record()]), /carpeta.*más de una vez/i);
});
test('frena el mismo documento y fecha dentro de un lote', () => {
  const first = record(), second = record(); second.driveFolderId = 'synthetic_folder_0002';
  assert.throws(() => parseRecords([first, second]), /documento y fecha.*repetidos/i);
});
test('rechaza lotes mayores al límite', () => {
  assert.throws(() => parseRecords(Array.from({ length: 21 }, record)), /Lote inválido/);
});

test('rechaza ficha importada sin dos nombres y dos apellidos', () => {
  const input = record(); input.name = 'Paciente Prueba';
  assert.throws(() => parseRecords([input]), ClinicalImportError);
});
