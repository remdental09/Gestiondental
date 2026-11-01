import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { proposeFromTranscript } from "../lib/dictation/proposal.ts";
import { applySelfCorrections } from "../lib/dictation/spoken.ts";
import { summarize, compare } from "../scripts/dictation-eval-lib.mjs";

const corpus = JSON.parse(readFileSync(new URL("./fixtures/dictation-corpus.json", import.meta.url), "utf8"));

test("el corpus tiene forma válida y solo datos ficticios", () => {
  assert.ok(corpus.cases.length >= 25);
  assert.equal(corpus.patient.rut, "11.111.111-1");
  const ids = new Set();
  for (const item of corpus.cases) {
    assert.match(item.id, /^c\d{2}-/);
    assert.ok(!ids.has(item.id), `id repetido ${item.id}`);
    ids.add(item.id);
    assert.equal(typeof item.text, "string");
    assert.equal(typeof item.expect, "object");
    assert.equal(typeof item.expect.patientWarning, "boolean", `${item.id} sin patientWarning`);
  }
});

for (const item of corpus.cases) {
  test(`corpus (reglas locales): ${item.id}`, async () => {
    const outcome = await proposeFromTranscript({ transcript: item.text, chart: [] }, null, () => {}, { today: corpus.today });
    assert.equal(outcome.engine, "reglas-locales");
    const diffs = compare(item.expect, summarize(outcome.proposal, item.text, corpus.patient));
    assert.deepEqual(diffs, [], JSON.stringify(diffs));
  });
}

test("autocorrecciones dictadas: solo queda la pieza o cara corregida", () => {
  const fix = (text) => applySelfCorrections(text).text;
  assert.equal(fix("pieza 2.4 caries mesial de esmalte no perdón la 2.5"), "pieza 2.5 caries mesial de esmalte");
  assert.match(fix("pieza 2.4 caries mesial perdón distal de esmalte"), /caries distal de esmalte/);
  assert.equal(applySelfCorrections("pieza 2.4 caries mesial de esmalte no perdón la 2.5").corrections.length > 0, true);
});

test("autocorrecciones: no confunde montos ni negaciones con piezas", () => {
  const same = (text) => assert.equal(applySelfCorrections(text).text, text);
  same("abonó 20 mil no perdón 30 mil");
  same("pieza 3.6 caries no la 4.6 sana");
  same("no hay caries en la 3.6");
});
