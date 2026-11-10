import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("las evoluciones quedan ligadas a lo que generan en endodoncia y periodoncia", () => {
  const endo = read("components/endodontics.tsx"), dict = read("components/clinical-dictation.tsx"), route = read("app/api/clinical/route.ts");
  assert.match(endo, /kind: "endo-session", ref: `\$\{c\.id\}:\$\{entry\.id\}`/);
  assert.match(endo, /kind: "endo-followup", ref: `\$\{c\.id\}:\$\{entry\.id\}`/);
  assert.match(dict, /evolutionId: savedNote\.id/);
  assert.match(route, /addLink\(ownerId, patientId, n\.id, link\.kind as LinkKind, link\.ref\)/);
  assert.match(route, /addLink\(ownerId, patientId, linkedEvolution, "perio", String\(e\.id\)\)/);
});

test("borrar o anular deshace odontograma, endograma y periodontograma ligados", () => {
  const route = read("app/api/clinical/route.ts"), links = read("app/evolution-links-db.ts");
  assert.equal(route.split("revertLinkedRecords(db, ownerId, patientId, evolutionId)").length - 1, 2);
  assert.match(links, /target\.sessions = target\.sessions\.filter\(s => s\.id !== entryId\)/);
  assert.match(links, /target\.followUps = target\.followUps\.filter\(f => f\.id !== entryId\)/);
  assert.match(links, /deletePerioExam\(examId\)/);
});

test("endograma con versiones por día y las tres pestañas con «Ver al»", () => {
  const db = read("app/endodontics-db.ts"), api = read("app/api/endodontics/route.ts"), page = read("app/page.tsx");
  assert.match(db, /INSERT INTO endodontic_versions/);
  assert.match(api, /params\.get\("versions"\) === "1"/);
  assert.match(api, /loadEndoAt\(ownerId, patientId, at\)/);
  for (const what of ['what="Periodontograma"', 'what="Endograma"', "<OdontogramDateBar dates={chartDates"]) assert.ok(page.includes(what), what);
  assert.match(page, /onSave=\{perioDate\?readOnlyChart:savePerio\}/);
  assert.match(page, /onSave=\{endoDate\?readOnlyChart:saveEndo\}/);
});
