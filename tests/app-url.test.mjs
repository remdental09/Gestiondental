import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildAppUrl, parseAppUrl, resolveAppUrl } from '../lib/app-url.ts';

test('URL de la ficha y sus pestañas', () => {
  assert.equal(buildAppUrl({ section: 'Ficha clínica', patientId: 9, tab: 'evoluciones' }), '/?paciente=9');
  assert.equal(buildAppUrl({ section: 'Ficha clínica', patientId: 9, tab: 'odontograma' }), '/?paciente=9&seccion=odontograma');
  assert.equal(buildAppUrl({ section: 'Ficha clínica', patientId: 9, tab: 'presupuestos' }), '/?paciente=9&seccion=presupuesto');
  assert.equal(buildAppUrl({ section: 'Inicio', patientId: 9, tab: 'evoluciones' }), '/');
  assert.equal(buildAppUrl({ section: 'Agenda', patientId: 9, tab: 'evoluciones' }), '/?seccion=agenda');
  assert.equal(buildAppUrl({ section: 'Pacientes', patientId: 0, tab: 'evoluciones' }), '/?seccion=pacientes');
});

test('ida y vuelta URL ⇄ vista', () => {
  for (const tab of ['evoluciones', 'odontograma', 'periodontograma', 'imagenes', 'presupuestos']) {
    const parsed = parseAppUrl(buildAppUrl({ section: 'Ficha clínica', patientId: 42, tab }).slice(1));
    assert.deepEqual(parsed, { section: 'Ficha clínica', patientId: 42, tab, invalidPatient: false });
  }
  for (const section of ['Resumen', 'Pacientes', 'Agenda', 'Presupuestos', 'Inicio']) assert.equal(parseAppUrl(buildAppUrl({ section, patientId: 0, tab: 'evoluciones' }).slice(1)).section, section);
  assert.equal(parseAppUrl('?paciente=9&seccion=evolucion').tab, 'evoluciones');
  assert.equal(parseAppUrl('?paciente=9&seccion=agenda').section, 'Agenda');
});

test('id inválido o de otra cuenta → lista con aviso, sin ids fijos', () => {
  for (const bad of ['?paciente=abc', '?paciente=-3', '?paciente=0', '?paciente=9.5', '?paciente=']) assert.equal(parseAppUrl(bad).invalidPatient, true, bad);
  const known = new Set([5, 9]);
  assert.deepEqual(resolveAppUrl(parseAppUrl('?paciente=9'), known, 5), { section: 'Ficha clínica', patientId: 9, tab: 'evoluciones', notFound: false });
  assert.deepEqual(resolveAppUrl(parseAppUrl('?paciente=777'), known, 5), { section: 'Pacientes', patientId: 5, tab: 'evoluciones', notFound: true });
  assert.equal(resolveAppUrl(parseAppUrl('?seccion=odontograma'), known, 5).section, 'Pacientes');
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /addEventListener\("popstate"/);
  assert.match(page, /pushState/);
  assert.doesNotMatch(page, /Copiar link/);
  assert.match(page, /<ClinicalDictation prominent /);
});
