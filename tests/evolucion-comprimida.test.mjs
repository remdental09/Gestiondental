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

test("la lista de evoluciones tiene su propia barra vertical para recorrerla", async () => {
  const { readFileSync } = await import("node:fs");
  const ui = readFileSync(new URL("../components/evolution-history.tsx", import.meta.url), "utf8");
  assert.match(ui, /data-testid="evolution-scroll"/);
  assert.match(ui, /max-h-\[70dvh\][^"]*overflow-y-auto/);
});
