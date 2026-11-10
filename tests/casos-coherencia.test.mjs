import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { proposeFromTranscript } from "../lib/dictation/proposal.ts";
import { judgeCase } from "../lib/dictation/coherence-cases.ts";

const bank = JSON.parse(readFileSync(new URL("./fixtures/casos-coherencia.json", import.meta.url), "utf8"));

for (const caso of bank.casos.filter((item) => !item.soloIA)) {
  test(`coherencia clínica (reglas): ${caso.id} — ${caso.nota}`, async () => {
    const { proposal } = await proposeFromTranscript({ transcript: caso.dictado, chart: caso.chart }, null, () => {}, { today: "2026-11-09" });
    assert.deepEqual(judgeCase(caso, proposal), []);
  });
}
