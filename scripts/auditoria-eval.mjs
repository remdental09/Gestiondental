// Mide el auditor posterior al llenado con fichas sintéticas (sin datos de pacientes).
import { readFileSync } from "node:fs";
import { measure } from "../lib/audit/eval.ts";

const cases = JSON.parse(readFileSync(new URL("../tests/fixtures/auditoria-fichas.json", import.meta.url), "utf8"));
const report = measure(cases);
for (const item of report.results) {
  const ok = !item.missed.length && !item.extra.length;
  console.log(`${ok ? "OK " : "FALLA"} ${item.id} ${item.nota}${ok ? "" : ` → faltó [${item.missed}] sobró [${item.extra}]`}`);
}
console.log(`\nErrores sembrados detectados: ${report.detected} de ${report.planted}`);
console.log(`Fichas correctas sin falsa alarma: ${report.cleanSilent} de ${report.clean}`);
process.exit(report.detected === report.planted && report.falseAlarms === 0 ? 0 : 1);
