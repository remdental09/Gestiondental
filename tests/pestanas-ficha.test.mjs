import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("cada pestaña de la ficha tiene su contenido, sin anidarse dentro de otra", () => {
  const tabs = [...source.matchAll(/\{value:"([a-z]+)",label:"[^"]+",style:/g)].map(match => match[1]);
  assert.ok(tabs.length >= 8, "faltan pestañas");
  const chunks = source.split('<TabsContent value="').slice(1).map(chunk => ({ value: chunk.slice(0, chunk.indexOf('"')), body: chunk }));
  assert.deepEqual(chunks.map(chunk => chunk.value).sort(), [...tabs].sort());
  // Cada bloque cierra su propio </TabsContent> antes de que empiece el siguiente (si no, una pestaña quedaría dentro de otra y no se vería).
  for (const chunk of chunks) assert.ok(chunk.body.includes("</TabsContent>"), `La pestaña ${chunk.value} no cierra antes de la siguiente`);
});
