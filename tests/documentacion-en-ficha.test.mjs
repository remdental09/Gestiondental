import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("../components/documentation-panel.tsx", import.meta.url), "utf8");

test("la ficha tiene un botón Documentación junto a Anamnesis que despliega el panel del paciente", () => {
  assert.match(page, /data-testid="documentation-button"/);
  assert.match(page, /embeddedPatientId=\{patient\.id\}/);
  assert.ok(page.indexOf('data-testid="documentation-button"') < page.indexOf("<AnamnesisButton"));
});

test("la documentación ya no es una sección suelta del menú", () => {
  assert.doesNotMatch(page, /\{name:"Documentación"/);
  assert.doesNotMatch(page, /section==="Documentación"&&/);
});

test("el panel embebido no muestra selector de paciente", () => {
  assert.match(panel, /embeddedPatientId/);
  assert.match(panel, /\{!embedded && <section className="surface">/);
});
