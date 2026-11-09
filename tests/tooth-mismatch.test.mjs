import test from "node:test";
import assert from "node:assert/strict";
import { fdiMentions, toothMismatch } from "../lib/dictation/tooth-mismatch.ts";

test("detecta título y texto con piezas distintas", () => {
  assert.deepEqual(toothMismatch("Endodoncia · FDI 2.1", "Se realiza limado de la pieza 1.1 hasta la lima 35."), { title: ["2.1"], body: ["1.1"] });
  assert.equal(toothMismatch("Endodoncia · FDI 2.1", "Pieza 2.1: instrumentación hasta lima 35."), null);
  assert.equal(toothMismatch("Control", "Pieza 1.1"), null);
});

test("no confunde medidas ni conicidades con piezas", () => {
  assert.deepEqual(fdiMentions("LT 21.5 mm, lima 35/.04, NaOCl 2.5 %, a 1.5 mm del ápice, pieza 3.6"), ["3.6"]);
});
