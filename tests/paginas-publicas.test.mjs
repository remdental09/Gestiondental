import test from "node:test";
import assert from "node:assert/strict";
import { aboutPage, privacyPage, termsPage, PUBLIC_CONTACT_EMAIL } from "../lib/public-pages.ts";
import { readFileSync } from "node:fs";

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

test("la política declara y justifica cada permiso de Google que pide la app", () => {
  const html = privacyPage();
  const oauth = readFileSync(new URL("../app/drive-oauth.ts", import.meta.url), "utf8");
  const scopes = new Set([...oauth.matchAll(/https:\/\/www\.googleapis\.com\/auth\/([a-z._]+)/g)].map((m) => m[1]));
  assert.ok(scopes.size >= 4, "se esperaban drive.file, calendar.readonly, calendar.events y gmail.send");
  for (const scope of scopes) assert.match(html, new RegExp("<em>" + scope.replace(".", "\\.") + "</em>"), "falta explicar " + scope);
  assert.match(html, /myaccount\.google\.com\/permissions/);
});

test("términos de uso: públicos, enlazados y con responsabilidad clínica del profesional", () => {
  const html = termsPage();
  assert.match(html, /Términos de uso/);
  assert.match(html, /responsabilidad exclusiva del profesional/);
  assert.match(html, /href="\/privacidad"/);
  assert.match(privacyPage(), /href="\/terminos"/);
  const worker = readFileSync(new URL("../worker.ts", import.meta.url), "utf8");
  assert.match(worker, /path === "\/terminos"/);
  const portada = readFileSync(new URL("../lib/portada-page.ts", import.meta.url), "utf8");
  assert.match(portada, /href="\/terminos"/);
});
