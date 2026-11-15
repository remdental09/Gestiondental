import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const odontogram = readFileSync(new URL("../components/odontogram.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("el editor de superficie permite elegir el material de la obturación", () => {
  assert.match(odontogram, /finding\.condition==="restored"&&<label[^>]*>Material/);
  assert.match(odontogram, /RESTORATION_MATERIALS=\["Resina compuesta","Vidrio ionómero","Amalgama","Cavit","IRM","Eugenato","Otro"\]/);
  assert.match(odontogram, /restoration-material-\$\{surface\}/);
  // Cavit, IRM y eugenato quedan como provisorios; el resto, definitivos.
  assert.match(odontogram, /material==="Cavit"\|\|material==="IRM"\|\|material==="Eugenato"\?"provisional"/);
});

test("el cuadro de confirmación muestra el estado en español, no el código interno", () => {
  assert.match(page, /restored:"obturación"/);
  assert.match(page, /other_restoration:"otra restauración"/);
  assert.doesNotMatch(page, /cara \$\{surface\}: \$\{finding\.condition\}\$/);
});
