import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../components/clinical-dictation.tsx", import.meta.url), "utf8");

test("la revisión del dictado es simple por defecto y el detalle se abre a pedido", () => {
  assert.match(source, /const \[detail, setDetail\] = useState\(false\)/);
  assert.match(source, /data-testid="dictation-odontogram-simple"/);
  assert.match(source, /data-testid="dictation-detail-toggle"/);
  assert.match(source, /\{detail && <details[^>]*dictation-structured-review/);
});

test("sin abrir el detalle, pagos, citas, ficha, periodontograma y avance de plan no se aplican solos", () => {
  for (const name of ["setPaymentItems", "setAppointmentItems", "setFichaItems", "setPriorEndoItems", "setRecessionItems", "setMobilityItems", "setClassItem"]) {
    const starts = [...source.matchAll(new RegExp(name + "\\(", "g"))].map((match) => match.index).filter((at) => /data\.proposal/.test(source.slice(at, at + 60)));
    assert.ok(starts.length > 0 && starts.every((at) => /detailRef\.current/.test(source.slice(at, at + 700))), name);
  }
  assert.match(source, /for \(const advance of detail \? advances : \[\]\)/);
  assert.match(source, /for \(const line of detail \? lines : \[\]\)/);
});
