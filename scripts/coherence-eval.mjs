#!/usr/bin/env node
// Banco de coherencia clínica del odontograma (tests/fixtures/casos-coherencia.json).
//   node --experimental-strip-types scripts/coherence-eval.mjs            → solo reglas (sin red, sin costo)
//   OPENAI_API_KEY=… node --experimental-strip-types scripts/coherence-eval.mjs --openai   → con la IA real (extractor + revisor)
// Nada se guarda en ninguna ficha. Sale con código 1 si algún caso falla.
import { readFileSync } from "node:fs";
import { proposeFromTranscript } from "../lib/dictation/proposal.ts";
import { createWorkersAiModel } from "../lib/dictation/workers-ai.ts";
import { judgeCase, itemKey } from "../lib/dictation/coherence-cases.ts";

const bank = JSON.parse(readFileSync(new URL("../tests/fixtures/casos-coherencia.json", import.meta.url), "utf8"));
const useAi = process.argv.includes("--openai");
const key = process.env.OPENAI_API_KEY?.trim();
if (useAi && !key) { console.error("Falta OPENAI_API_KEY en el entorno."); process.exit(2); }
const model = useAi ? createWorkersAiModel(null, { openAi: { apiKey: key }, preferOpenAi: true }) : null;

let passed = 0;
for (const caso of bank.casos) {
  const { proposal, engine } = await proposeFromTranscript({ transcript: caso.dictado, chart: caso.chart }, model, () => {}, { today: new Date().toISOString().slice(0, 10) });
  const fails = judgeCase(caso, proposal);
  if (!fails.length) passed++;
  const items = proposal.odontogram.map((item) => itemKey(item) + (item.advisory ? `[${item.coherence ?? "aviso"}]` : "")).join(", ") || "—";
  console.log(`${fails.length ? "FALLA" : "ok   "} ${caso.id}${caso.trampa ? " (trampa)" : ""} · ${engine} · ${items}${fails.length ? `\n      ${fails.join("; ")}` : ""}`);
}
console.log(`\n${passed}/${bank.casos.length} casos correctos${useAi ? " con IA" : " con reglas"}.`);
process.exit(passed === bank.casos.length ? 0 : 1);
