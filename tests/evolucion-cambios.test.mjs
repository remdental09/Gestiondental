import test from "node:test";
import assert from "node:assert/strict";
import { proposeChangesFromEvolution } from "../lib/evolution-changes.ts";

const empty = { teeth: {}, surfaces: {}, crowns: {}, extras: {} };
const run = (body, chart = empty, skip = []) => proposeChangesFromEvolution(body, "2026-11-24", chart, skip);

test("una obturación escrita arma una tarjeta con antes → después", () => {
  const { cards } = run("Se realiza restauración de resina compuesta en las caras distal y oclusal de la pieza 3.6.");
  assert.equal(cards.length, 1);
  assert.equal(cards[0].title, "Pieza 3.6");
  assert.equal(cards[0].lines.length, 2);
  assert.ok(cards[0].lines.every((line) => line.before === "Sin registro" && /obturación/.test(line.after)));
});

test("lo que ya está igual en el odontograma no vuelve a aparecer", () => {
  const surfaces = { 36: { O: { condition: "restored", restorationMaterial: "Resina compuesta" }, D: { condition: "restored", restorationMaterial: "Resina compuesta" } } };
  assert.equal(run("Se realiza restauración de resina compuesta en las caras distal y oclusal de la pieza 3.6.", { ...empty, surfaces }).cards.length, 0);
});

test("planes, controles y negaciones no proponen nada", () => {
  for (const text of ["Se planifica obturar la pieza 1.4.", "Control de rutina, sin hallazgos.", "Sin endodoncia en la pieza 2.5."]) assert.equal(run(text).cards.length, 0, text);
});

test("endodoncia y extracción salen como estado de la pieza", () => {
  const { cards } = run("Pieza 4.6: trepanación y curación intraconducto. Se extrae la pieza 1.8.");
  const byTooth = Object.fromEntries(cards.map((card) => [card.tooth, card.lines[0].after]));
  assert.equal(byTooth[46], "Endodoncia en proceso");
  assert.equal(byTooth[18], "Ausente");
});

test("las piezas que el servidor ya actualiza solas se omiten", () => {
  assert.equal(run("Se extrae la pieza 1.8.", empty, [18]).cards.length, 0);
});
