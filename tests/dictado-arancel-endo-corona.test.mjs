import test from "node:test";
import assert from "node:assert/strict";
import { proposeFromTranscript } from "../lib/dictation/proposal.ts";

// Textos sintéticos (estilo ficha). Ninguno es una evolución real.
const run = async (text) => (await proposeFromTranscript({ transcript: text, chart: [] }, null, () => {}, { today: "2026-11-24", sensitivity: "basic" })).proposal;
const pres = (p) => (p.prestaciones ?? []).map((x) => `${x.code}@${x.tooth}${x.advisory ? "?" : ""}`).sort();

test("endodoncia terminada (OBC) sin vitalidad: propone el tratamiento de conductos del grupo, sin marcar", async () => {
  const p = await run("Pza 2.7 Trepanación Endodóntica / Cdto MV-18mm-ref cusp MV-RB50 - Cdto DV-18mm - Cdto P-20mm / NaOCl-EDTA-Suero / OBC Guta y Totalfill / VI / A2% 1 tubo infiltrativa");
  assert.deepEqual(pres(p).filter((x) => x.startsWith("5006")), ["5006015@27?"]);
  assert.ok(!pres(p).some((x) => x.startsWith("5001019")), "no es trepanación de urgencia");
});

test("endodoncia terminada con necrosis dictada: el código con lesión apical queda marcado", async () => {
  const p = await run("Pieza 3.2 con necrosis pulpar. Cdto U 21mm-ref borde I / OBC Guta y Totalfill / VI");
  assert.ok(pres(p).includes("5006007@32"), pres(p).join(","));
});

test("instalación de corona sobre implante con TiBase: prótesis atornillada sobre implante, no instalación de implante", async () => {
  const p = await run("INSTALACION DE CORONA DE PZA 2.5, SOBRE IMPLANTE, TIBASE 3 ALT 7,7. TORQUE A 20 N, CIERRE DE CHIMENEA CON COMPOSITE");
  assert.ok(pres(p).includes("5011045@25"), pres(p).join(","));
  assert.ok(!pres(p).some((x) => x.startsWith("5011001") || x.startsWith("5011052")), pres(p).join(","));
});

test("instalación de corona sobre implante sin TiBase: cementada sobre implante", async () => {
  const p = await run("Instalación de corona sobre implante pza 3.6 / control de oclusión");
  assert.ok(pres(p).includes("5011046@36"), pres(p).join(","));
});

test("corona Cerec/E-Max cementada en diente natural: prótesis fija unitaria libre de metal", async () => {
  const p = await run("Pza 2.5 Corona Cerec E-Max A2 HT / Duolink-Futurabond / Pulido / control de oclusión");
  assert.ok(pres(p).includes("5007041@25"), pres(p).join(","));
});

test("prueba y cementación de corona sin material: libre de metal propuesta sin marcar", async () => {
  const p = await run("PRUEBA Y CEMENTACION DE CORONA DE 2.2. SE CITA A CONTROL");
  assert.ok(pres(p).includes("5007041@22?"), pres(p).join(","));
});

test("recementación o corona provisoria no se cobran como corona definitiva; «pieza 2.1 corona sobre implante» sigue siendo hallazgo", async () => {
  const a = await run("Pza 1.2 se recementa corona con Choise / se controla oclusión");
  assert.ok(!pres(a).some((x) => x.startsWith("5007041")), pres(a).join(","));
  const b = await run("pieza 2.1 corona sobre implante");
  assert.ok(b.odontogram.some((o) => o.tooth === 21 && o.status === "Implante"));
});
