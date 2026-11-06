import test from "node:test";
import assert from "node:assert/strict";
import { spokenAlerts } from "../lib/dictation/spoken-alerts.ts";

test("avisos hablados: frases cortas, sin citas ni etiquetas, con la pieza dicha en voz natural", () => {
  const phrases = spokenAlerts(
    ["IA: FDI 3.6: ¿profundidad de la caries (esmalte, dentina)? Opcional: «Caries en la 3.6»."],
    ["Valores: ¿hubo presupuesto o pago?", "Próxima cita: ¿cuándo vuelve?"],
  );
  assert.deepEqual(phrases, ["pieza 3 punto 6: ¿profundidad de la caries (esmalte, dentina)?", "¿hubo presupuesto o pago?", "¿cuándo vuelve?"]);
});

test("avisos hablados: nada que avisar, sin repetidos y máximo cuatro más el resto en pantalla", () => {
  assert.deepEqual(spokenAlerts([], []), []);
  assert.deepEqual(spokenAlerts(["¿Qué cara es?", "¿Qué cara es?"], []), ["¿Qué cara es?"]);
  const many = spokenAlerts(["Duda uno aquí", "Duda dos aquí", "Duda tres aquí", "Duda cuatro aquí", "Duda cinco aquí", "Duda seis aquí"], []);
  assert.equal(many.length, 5);
  assert.equal(many[4], "Y 2 avisos más en pantalla.");
});
