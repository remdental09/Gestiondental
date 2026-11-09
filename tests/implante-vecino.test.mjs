import test from "node:test";
import assert from "node:assert/strict";
import { proposeFromTranscript, neighbourScoped } from "../lib/dictation/proposal.ts";

const quick = async (transcript) => (await proposeFromTranscript({ transcript, chart: [] }, null, () => {}, { today: "2026-11-09" })).proposal;
const statuses = (p) => p.odontogram.filter((i) => i.kind === "status").map((i) => [i.tooth, i.status]);

test("«la 20 adyacente al implante de la 19»: el implante es de la 19, nunca de la 20", async () => {
  const p = await quick("La pieza 20 se encuentra adyacente al implante de la pieza 19 y la pieza 21 se observa sana.");
  assert.ok(!statuses(p).some(([tooth, status]) => tooth === 45 && status === "Implante"), JSON.stringify(statuses(p)));
  assert.ok(!statuses(p).some(([tooth, status]) => tooth === 44 && status === "Implante"));
});

test("neighbourScoped reparte la frase entre las piezas", () => {
  const s = "La pieza 20 se encuentra adyacente al implante de la pieza 19 y la pieza 21 se observa sana.";
  assert.doesNotMatch(neighbourScoped(s, 45), /implante/i);
  assert.match(neighbourScoped(s, 46), /implante/i);
  assert.doesNotMatch(neighbourScoped(s, 44), /implante/i);
  assert.equal(neighbourScoped("Implante en la pieza 19", 46), "Implante en la pieza 19");
});

test("un implante de la propia pieza sigue registrándose", async () => {
  const p = await quick("Se instala un implante en la pieza 19.");
  assert.ok(statuses(p).some(([tooth, status]) => tooth === 46 && status === "Implante"));
});
