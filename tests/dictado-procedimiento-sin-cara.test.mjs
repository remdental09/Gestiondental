import test from "node:test";
import assert from "node:assert/strict";
import { proposeFromTranscript } from "../lib/dictation/proposal.ts";

const run = async (transcript) => (await proposeFromTranscript({ transcript, chart: [] }, null, () => {}, { today: "2026-11-23" })).proposal;

test("«eliminación de caries y trepanación» es un procedimiento: no pregunta la superficie del hallazgo", async () => {
  const p = await run("Pieza 7 con caries palatina. Se procede a eliminación de caries y trepanación. Se deja sello provisorio hasta la próxima sesión.");
  assert.ok(!p.clarifications.some((c) => /Falta la superficie/.test(c)), p.clarifications.join(" | "));
});
