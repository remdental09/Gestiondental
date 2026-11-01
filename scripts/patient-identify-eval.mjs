// Evalúa la identificación del paciente (nuevo vs existente) de los dictados hechos desde Inicio.
// Solo código: no usa IA ni red. Lo llama scripts/dictation-eval.mjs y tests/patient-identify.test.mjs.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decidePatient } from '../lib/dictation/patient-identify.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function runPatientIdentifyEval() {
  const corpus = JSON.parse(readFileSync(join(root, 'tests/fixtures/patient-identify-corpus.json'), 'utf8'));
  const rows = corpus.cases.map((item) => {
    const result = decidePatient(item.text, corpus.patients);
    const diffs = [];
    const e = item.expect;
    const check = (field, actual, expected) => { if (JSON.stringify(actual) !== JSON.stringify(expected)) diffs.push({ field, expected, actual }); };
    check('decision', result.decision, e.decision);
    if ('patientId' in e) check('patientId', result.suggestedPatientId, e.patientId);
    for (const field of ['name', 'rut', 'birthDate', 'phone', 'email', 'newPatientHint']) if (field in e) check(field, result.identity[field], e[field]);
    if (e.candidates) check('candidates', result.candidates.map((c) => c.id).sort(), [...e.candidates].sort());
    return { item, result, diffs };
  });
  return { rows, passed: rows.filter((row) => !row.diffs.length).length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { rows, passed } = runPatientIdentifyEval();
  for (const row of rows) console.log(`${row.diffs.length ? 'FALLA' : 'ok   '} ${row.item.id}${row.diffs.length ? ` ${JSON.stringify(row.diffs)}` : ''}`);
  console.log(`Identificación de paciente: ${passed}/${rows.length}`);
}
