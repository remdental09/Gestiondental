import test from "node:test";
import assert from "node:assert/strict";
import { asksKnownAbbreviation, clinicShorthandPrompt, expandClinicShorthand } from "../lib/dictation/clinic-shorthand.ts";

// Dudas y textos sintéticos (estilo ficha). Ninguno es una evolución real.
test("la IA no pregunta el significado de siglas del glosario (An-Ab, PIT, JIG, IRM, TiBase, CBCT, RC)", () => {
  for (const q of [
    "IA: ¿Qué significa «An-Ab» en el dictado? ¿Corresponde a algún material, medicamento o procedimiento?",
    "IA: ¿Qué significa «An-Ab.» en este contexto?",
    "IA: ¿Qué significa «PIT» en este contexto?",
    "IA: ¿El «jig» corresponde a un plano deprogramador?",
    "¿Qué significa «IRM»?",
    "IA: ¿A qué se refiere «TiBase»?",
    "IA: ¿Qué significa la sigla «CBCT»?",
    "IA: ¿Qué significa «RC» en la pieza 1.4?",
  ]) assert.ok(asksKnownAbbreviation(q), q);
});

test("las dudas clínicas que nombran una sigla se mantienen", () => {
  for (const q of [
    "IA: ¿El CBCT corresponde a una zona, a un maxilar o a ambos maxilares para seleccionar el código arancelario?",
    "IA: ¿El cambio de TiBase se realizó hoy o quedó planificado?",
    "IA: ¿Qué significa «R» en «R 6 puntos 4J»?",
    "IA: ¿RB5 corresponde a una lima Reciproc Blue #50 (RB50) u otro calibre?",
  ]) assert.ok(!asksKnownAbbreviation(q), q);
});

test("el glosario de la IA incluye las siglas nuevas", () => {
  const prompt = clinicShorthandPrompt();
  for (const k of ["An-Ab", "PIT", "TiBase", "Blqto", "Tope cervical", "H de Ca", "B/W", "IRM", "CBCT", "JIG", "RB50", "Rc / RC"]) assert.ok(prompt.includes(k), k);
});

test("Blqto y H de Ca se expanden; An-Ab es analgésico y antibiótico", () => {
  const { text, corrections } = expandClinicShorthand("Pza 3.1 Blqto intracameral 1 sesión / H de Ca / Algodón- VI / An-Ab");
  assert.match(text, /blanqueamiento intracameral/);
  assert.match(text, /hidróxido de calcio/);
  assert.match(text, /analgésico y antibiótico/);
  assert.doesNotMatch(text, /An-Ab/);
  assert.ok(corrections.some((c) => /Blqto/.test(c.reason)));
});

test("RC en mayúsculas con caras es resina compuesta", () => {
  const { text } = expandClinicShorthand("Pza 2.4 RC MO -Denticlean-Cap Hib SBU-A2 Z250");
  assert.match(text, /Pieza 2\.4 restauración de resina compuesta mesial y oclusal/);
});

test("An-Ab, Ab-An, AB-AN y ATB y AN = analgésico y antibiótico (indicación, no pieza ni acto); PIT queda tal cual", () => {
  for (const [input, expected] of [
    ["Urgencia pza 3.6 trepanación / An-Ab continuar", /analgésico y antibiótico continuar/],
    ["Se indica Ab-An por 7 días", /se indica analgésico y antibiótico por 7 días/i],
    ["Control. AB-AN.", /analgésico y antibiótico/],
    ["Se receta ATB y AN", /antibiótico y analgésico/],
  ]) {
    const { text, corrections } = expandClinicShorthand(input);
    assert.match(text, expected, input);
    assert.doesNotMatch(text, /\b(?:An-Ab|Ab-An|AB-AN|AN)\b/, input);
    assert.ok(corrections.some((c) => /analgésico/.test(c.corrected)), input);
  }
  // No se confunde con palabras que contienen las letras.
  assert.equal(expandClinicShorthand("Paciente Ana-Abril refiere dolor").text, "Paciente Ana-Abril refiere dolor");
  assert.match(expandClinicShorthand("Evaluación PIT").text, /PIT/);
  const prompt = clinicShorthandPrompt();
  assert.match(prompt, /An-Ab[^;]*= analgésico y antibiótico/);
  assert.match(prompt, /PIT = [^;]*por confirmar/);
});
