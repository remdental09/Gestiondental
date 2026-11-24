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

test("sin abrir el detalle, pagos, citas, ficha, endodoncias previas y avance de plan no se aplican solos", () => {
  for (const name of ["setPaymentItems", "setAppointmentItems", "setFichaItems", "setPriorEndoItems"]) {
    const starts = [...source.matchAll(new RegExp(name + "\\(", "g"))].map((match) => match.index).filter((at) => /data\.proposal/.test(source.slice(at, at + 60)));
    assert.ok(starts.length > 0 && starts.every((at) => /detailRef\.current/.test(source.slice(at, at + 700))), name);
  }
  assert.match(source, /for \(const advance of detail \? advances : \[\]\)/);
  assert.match(source, /for \(const line of detail \? lines : \[\]\)/);
});

test("el periodontograma queda a la vista en la revisión simple", () => {
  const perio = source.indexOf('<h3 className="font-semibold">Periodontograma</h3>');
  const toggle = source.indexOf('data-testid="dictation-detail-toggle"');
  const detailBlock = source.indexOf("{detail && <details");
  assert.ok(perio > 0 && perio < detailBlock && perio < toggle);
});

test("al guardar un dictado se abre la misma hoja y solo se aplica lo aprobado", () => {
  assert.match(source, /EvolutionChangesSheet cards=\{changesAsk\.cards\}/);
  assert.match(source, /approvedIds \? !approvedIds\.has\(item\.id\) : item\.decision !== "accepted"/);
  assert.match(source, /decision\.action === "cancel"\) return;/);
});
