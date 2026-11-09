import test from "node:test";
import assert from "node:assert/strict";
import { aboutPage, privacyPage, PUBLIC_CONTACT_EMAIL } from "../lib/public-pages.ts";

test("política de privacidad cubre lo que Google exige", () => {
  const html = privacyPage();
  assert.match(html, /Política de privacidad/);
  assert.match(html, /drive\.file/);
  assert.match(html, /Política de Datos de Usuario de los Servicios de API de Google/);
  assert.match(html, /uso limitado/);
  assert.match(html, /OpenAI/);
  assert.match(html, new RegExp(PUBLIC_CONTACT_EMAIL));
  assert.match(html, /eliminación/);
});

test("página de descripción enlaza la política y no incluye datos de pacientes", () => {
  const html = aboutPage();
  assert.match(html, /href="\/privacidad"/);
  assert.doesNotMatch(html, /\b\d{1,2}\.\d{3}\.\d{3}-[\dK]\b/);
});
