// Utilidades del set de regresión del dictado: resume una propuesta en campos comparables y
// compara con lo esperado. Lo usan scripts/dictation-eval.mjs y tests/dictation-corpus.test.mjs.
import { checkPatientMentions } from '../lib/dictation/patient-check.ts';

const sorted = (list) => [...list].sort((a, b) => String(a).localeCompare(String(b), 'es'));

function odontogramLine(item) {
  if (item.kind === 'surface') {
    const f = item.finding ?? {};
    return `${item.tooth} ${item.surface} ${f.condition}${f.condition === 'caries' ? `:${f.depth ?? '-'}` : ''}`;
  }
  if (item.kind === 'crown') return `${item.tooth} corona${item.foundation === 'implant' ? ':implante' : ''}`;
  return `${item.tooth} ${item.status}`;
}

/** Resumen comparable. Los ítems en conflicto o solo de aviso parten rechazados en la revisión, así que no cuentan. */
export function summarize(proposal, transcript, patient) {
  const check = checkPatientMentions(transcript, patient);
  return {
    odontogram: sorted(proposal.odontogram.filter((item) => !item.conflict && !item.advisory).map(odontogramLine)),
    unchecked: sorted(proposal.odontogram.filter((item) => item.conflict || item.advisory).map(odontogramLine)),
    incomplete: sorted((proposal.incomplete ?? []).map(odontogramLine)),
    perio: sorted(proposal.perio.map((item) => `${item.tooth} ${item.site} ${item.depth}${item.bleeding ? ' sangrado' : ''}${item.suppuration ? ' supuración' : ''}`)),
    perioPending: (proposal.perioPending ?? []).length,
    mobility: sorted((proposal.mobility ?? []).map((item) => `${item.tooth} ${item.grade}`)),
    payments: sorted((proposal.payments ?? []).map((item) => `${item.amount} ${item.method ?? '-'}`)),
    appointments: sorted((proposal.appointments ?? []).map((item) => `${item.day ?? '-'} ${item.time ?? '-'}`)),
    ficha: sorted((proposal.ficha ?? []).map((item) => item.field)),
    budget: sorted(proposal.budget.map((item) => String(item.amount))),
    diagnoses: sorted((proposal.diagnoses ?? []).map((item) => `${item.tooth ?? '-'} ${item.code || `sin código: ${item.title}`}${item.suggested ? ' (sugerido)' : ''}`)),
    patientWarning: check.mismatches.length > 0,
    clarifications: proposal.clarifications,
    note: proposal.evolution?.body ?? '',
    type: proposal.evolutionKind?.type ?? '',
    title: proposal.evolution?.title ?? '',
    corrected: proposal.corrected?.text ?? transcript,
  };
}

const LIST_FIELDS = ['odontogram', 'unchecked', 'incomplete', 'perio', 'mobility', 'payments', 'appointments', 'ficha', 'budget', 'diagnoses'];

/** Diferencias por campo; solo se comparan los campos que el caso declara. */
export function compare(expect, actual) {
  const diffs = [];
  for (const field of LIST_FIELDS) {
    if (!(field in expect)) continue;
    const want = sorted(expect[field]);
    const got = actual[field];
    const missing = want.filter((value) => !got.includes(value));
    const extra = got.filter((value) => !want.includes(value));
    if (missing.length || extra.length) diffs.push({ field, missing, extra });
  }
  for (const field of ['perioPending', 'patientWarning']) {
    if (field in expect && expect[field] !== actual[field]) diffs.push({ field, missing: [String(expect[field])], extra: [String(actual[field])] });
  }
  for (const pattern of expect.clarify ?? []) {
    if (!actual.clarifications.some((q) => new RegExp(pattern, 'iu').test(q))) diffs.push({ field: 'clarify', missing: [pattern], extra: [] });
  }
  for (const pattern of expect.noClarify ?? []) {
    const hit = actual.clarifications.filter((q) => new RegExp(pattern, 'iu').test(q));
    if (hit.length) diffs.push({ field: 'noClarify', missing: [], extra: hit });
  }
  if ('clarificationCount' in expect && expect.clarificationCount !== actual.clarifications.length) {
    diffs.push({ field: 'clarificationCount', missing: [String(expect.clarificationCount)], extra: actual.clarifications });
  }
  if ('type' in expect && expect.type !== actual.type) diffs.push({ field: 'type', missing: [expect.type], extra: [actual.type] });
  for (const pattern of expect.clarifyExcludes ?? []) {
    const hit = actual.clarifications.find((q) => new RegExp(pattern, 'iu').test(q));
    if (hit) diffs.push({ field: 'clarifyExcludes', missing: [], extra: [hit] });
  }
  if ('titleIncludes' in expect && !actual.title.toLowerCase().includes(expect.titleIncludes.toLowerCase())) diffs.push({ field: 'titleIncludes', missing: [expect.titleIncludes], extra: [actual.title] });
  for (const text of expect.noteIncludes ?? []) if (!actual.note.includes(text)) diffs.push({ field: 'noteIncludes', missing: [text], extra: [] });
  for (const text of expect.noteExcludes ?? []) if (actual.note.includes(text)) diffs.push({ field: 'noteExcludes', missing: [], extra: [text] });
  // Texto corregido (léxico dental): sin distinguir mayúsculas.
  const corrected = (actual.corrected ?? '').toLowerCase();
  for (const text of expect.correctedIncludes ?? []) if (!corrected.includes(text.toLowerCase())) diffs.push({ field: 'correctedIncludes', missing: [text], extra: [actual.corrected] });
  for (const text of expect.correctedExcludes ?? []) if (corrected.includes(text.toLowerCase())) diffs.push({ field: 'correctedExcludes', missing: [], extra: [text] });
  return diffs;
}
