import test from "node:test";
import assert from "node:assert/strict";
import { proposeFromTranscript } from "../lib/dictation/proposal.ts";

// Textos sintéticos (estilo ficha). Ninguno es una evolución real.
const run = async (text) => (await proposeFromTranscript({ transcript: text, chart: [] }, null, () => {}, { today: "2026-11-24", sensitivity: "basic" })).proposal;
const states = (p) => p.odontogram.filter((o) => o.kind === "status" && !o.advisory).map((o) => `${o.tooth}:${o.status}`).sort();
const pres = (p) => (p.prestaciones ?? []).filter((x) => !x.advisory).map((x) => `${x.code}@${x.tooth}`).sort();

test("exodoncia por párrafo «PZA X:» con implante inmediato en cada uno: ambas piezas quedan Implante (y no ausente)", async () => {
  const p = await run("PZA 1.4: ANL AL 2%, EXODONCIA E INSTALACION DE I,PLANTE 4x13, 35N TORQUE. QUEDA CONECTADO CON HEALING CAP.\n\nPZA 3.6: SPIX EXODONCIA CON ODONTOSECCION. INSTALO IMPLANTE EN SEPTUM Y RELLENO CON STICKY. QUEDA CONECTADO CON HEALING.");
  assert.deepEqual(states(p), ["14:Implante", "36:Implante"]);
  assert.deepEqual(pres(p), ["5011018@14", "5011018@36"]);
});

test("exodoncia sin implante en ficha («1.4 y 1.5, EXODONCIA»): ambas Ausentes con su arancel", async () => {
  const p = await run("1.4 Y 1.5, EXODONCIA. SUTURA. INDICO AINES SOS.");
  assert.deepEqual(states(p), ["14:Ausente", "15:Ausente"]);
  assert.deepEqual(pres(p), ["5003001@14", "5003001@15"]);
});

test("lo que no es extraer hoy no marca Ausente: control post exodoncia, derivación, «si no se deriva a exodoncia»", async () => {
  for (const text of [
    "Pcte con dolor en zona de la exodoncia de la Pza 4.8, se irriga con suero.",
    "Urgencia por dolor en Pza 1.7 / ajuste oclusal / se deriva a Dr. para exodoncia de Pza 1.7",
    "Pza 2.7 / aún drena / se dará última oportunidad si no se deriva a exodoncia",
  ]) {
    const p = await run(text);
    assert.ok(!states(p).some((s) => s.endsWith(":Ausente")), `${text} → ${states(p)}`);
  }
});

test("coronas provisionales o el control de una instalación no se cobran como corona definitiva; el implante queda", async () => {
  const a = await run("INSTALACION DE CORONAS PROVISIONALES SOBRE IMPLANTES 3.6 Y 3.7");
  assert.ok(!pres(a).some((x) => /^(?:5011045|5011046|5011001|5007041)/.test(x)), pres(a).join(","));
  assert.ok(states(a).includes("36:Implante") && states(a).includes("37:Implante"), states(a).join(","));
  const b = await run("CONTROL DE INSTALACION DE CORONAS DE IMPLANTES 2.4 Y 2.5 EN PERFECTO ESTADO.");
  assert.ok(!pres(b).some((x) => /^(?:5011045|5011046|5007041)/.test(x)), pres(b).join(","));
});
