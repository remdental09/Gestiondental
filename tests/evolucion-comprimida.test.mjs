import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../components/evolution-history.tsx", import.meta.url), "utf8");

test("las evoluciones salen comprimidas y se abren una a una o todas", () => {
  assert.match(source, /useState<Set<number>>\(\(\) => new Set\(\)\)/);
  assert.match(source, /data-testid="evolution-row"/);
  assert.match(source, /aria-expanded=\{open\}/);
  assert.match(source, /data-testid="evolution-toggle-all"/);
  assert.match(source, /evolutionHeadline\(note\)/);
});

test("el contenido completo, los botones de edición y el riel solo existen al abrir; editar fuerza abrir", () => {
  assert.match(source, /\{\(expanded\.has\(note\.id\) \|\| editingId === note\.id\) && <div/);
});

test("se puede filtrar por pieza o zona y se conservan las anuladas visibles", () => {
  assert.match(source, /data-testid="evolution-zone-filter"/);
  assert.match(source, /annulled && <span[^>]*>Anulada/);
});

test("la barra de herramientas sale abierta en toda evolución expandida, no solo en la última", () => {
  const rail = readFileSync(new URL("../components/evolution-rail.tsx", import.meta.url), "utf8");
  assert.match(rail, /useState\(true\)/);
  assert.doesNotMatch(rail, /useState\(latest\)/);
});

test("el titular de la evolución no se aprieta en una columna: la fila baja los chips y el titular tiene ancho mínimo", () => {
  const ui = readFileSync(new URL("../components/evolution-history.tsx", import.meta.url), "utf8");
  assert.match(ui, /data-testid="evolution-row"/);
  assert.match(ui, /flex-wrap items-center gap-x-2/);
  assert.match(ui, /min-w-\[12rem\] flex-1 basis-\[14rem\]/);
  assert.match(ui, /max-w-\[22rem\] truncate/);
});
