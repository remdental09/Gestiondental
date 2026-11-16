import test from "node:test";
import assert from "node:assert/strict";
import { proposeFromTranscript } from "../lib/dictation/proposal.ts";

const rules = async (transcript, chart = []) => (await proposeFromTranscript({ transcript, chart }, null, () => {}, { today: "2026-11-16" })).proposal;

import { readFileSync } from "node:fs";
test("tras guardar, el dictado siguiente parte en blanco", () => {
  const ui = readFileSync(new URL("../components/clinical-dictation.tsx", import.meta.url), "utf8");
  assert.match(ui, /savedSinceOpen\.current = true;\s*setResult\(check\)/);
  assert.match(ui, /if \(savedSinceOpen\.current\) \{[\s\S]{0,120}setTranscript\(""\)/);
});

test("una atención con varias piezas las nombra todas en el título", async () => {
  const p = await rules("Pieza 3.6: fractura radicular vertical. Pieza 4.6: granuloma apical.");
  assert.match(p.evolution?.title ?? "", /FDI 3\.6, 4\.6/);
});
