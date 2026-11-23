import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("el menú lateral no repite «Ficha clínica»: es lo mismo que «Pacientes» y esa entrada queda marcada", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const nav = page.slice(page.indexOf("const nav=("), page.indexOf("const goHome"));
  assert.ok(!nav.includes('name:"Ficha clínica"'));
  assert.ok(nav.includes('name:"Pacientes"'));
  assert.ok(page.includes('(section==="Ficha clínica"?"Pacientes":section)===name'));
});
