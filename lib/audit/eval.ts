import { auditRecord, type AuditInput, type AuditRule } from "./record-audit.ts";

export type AuditCase = Omit<AuditInput, "patientId"> & { id: string; nota: string; esperadas: AuditRule[] };

/** Mide el auditor con fichas sintéticas: errores sembrados (debe encontrarlos) y fichas correctas (no debe avisar). */
export function measure(cases: AuditCase[]) {
  const results = cases.map((test) => {
    const found = [...new Set(auditRecord({ ...test, patientId: 1 }).map((finding) => finding.rule))].sort();
    const expected = [...test.esperadas].sort();
    return { id: test.id, nota: test.nota, expected, found, missed: expected.filter((rule) => !found.includes(rule)), extra: found.filter((rule) => !expected.includes(rule)) };
  });
  const planted = results.filter((item) => item.expected.length);
  const clean = results.filter((item) => !item.expected.length);
  const detected = planted.filter((item) => !item.missed.length).length;
  const falseAlarms = results.filter((item) => item.extra.length).length;
  return { results, planted: planted.length, detected, clean: clean.length, cleanSilent: clean.filter((item) => !item.extra.length).length, falseAlarms };
}
