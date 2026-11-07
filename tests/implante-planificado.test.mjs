import test from "node:test";
import assert from "node:assert/strict";
import { proposeFromTranscript } from "../lib/dictation/proposal.ts";
import { lexiconDoubts } from "../lib/dictation/spoken.ts";

const run = async (transcript) => (await proposeFromTranscript({ transcript, chart: [] }, null, () => {}, { today: "2026-11-07" })).proposal;
const states = (p) => p.odontogram.map((item) => `${item.tooth}:${item.status}${item.conflict ? ":conflicto" : ""}`);

test("preservación alveolar con implante diferido: la pieza queda Ausente, sin Implante", async () => {
  const p = await run("Se realiza la extracción de la pieza 14 y preservación alveolar con injerto de xenoinjerto y membrana de colágeno. Se sutura con puntos simples. Implante diferido en cuatro meses.");
  assert.deepEqual(states(p), ["26:Ausente"]);
});

test("elevación de seno con implante a los seis meses: no se marca Implante", async () => {
  const p = await run("Se realiza elevación de seno maxilar por vía lateral en la pieza 16 con injerto óseo y membrana. Se sutura. Implante diferido a los seis meses.");
  assert.deepEqual(states(p), []);
});

test("«se instalará un implante» es plan, no un hecho", async () => {
  const p = await run("Se realiza la extracción de la pieza 36. En tres meses se instalará un implante en la pieza 36.");
  assert.deepEqual(states(p), ["36:Ausente"]);
});

test("extracción e instalación en la misma frase: la pieza queda Implante (y la otra pieza también)", async () => {
  const p = await run("Se instalan dos implantes. En la pieza 36 se realiza extracción y se instala un implante de 4,1 por 10 en el alvéolo fresco. En la pieza 37 ausente se instala un implante de 4,1 por 8 milímetros. Marca Straumann ambos.");
  assert.deepEqual(states(p).sort(), ["36:Implante", "37:Implante"]);
});

test("implante inmediato en oraciones separadas sigue quedando solo Implante", async () => {
  const p = await run("Cirugía de implante en la pieza 8. Se realiza la extracción de una raíz dental en la pieza 8. Se instala en el alvéolo fresco un implante de 3,3 por 10 milímetros.");
  assert.deepEqual(states(p), ["11:Implante"]);
});

test("una extracción sin implante sigue dejando la pieza Ausente", async () => {
  const p = await run("Se realiza la extracción de la pieza 14 por caries destructiva.");
  assert.deepEqual(states(p), ["26:Ausente"]);
});

test("«Arcsys» bien escrito no pregunta; «Arcis» y «Arsis» sí", () => {
  const ask = (t) => lexiconDoubts(t).filter((q) => /Arcsys/.test(q)).length;
  assert.equal(ask("implante de marca FGM Arcsys"), 0);
  assert.equal(ask("implante de marca FGM Arcis"), 1);
  assert.equal(ask("implante de marca FGM Arsis"), 1);
});
