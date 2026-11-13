import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const oauth = readFileSync(new URL("../app/drive-oauth.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/calendar/route.ts", import.meta.url), "utf8");
const ui = readFileSync(new URL("../components/calendar-sources.tsx", import.meta.url), "utf8");

test("la agenda clínica solo importa los calendarios elegidos, no todos los visibles", () => {
  assert.doesNotMatch(oauth, /cal\.primary \|\| cal\.selected/);
  assert.match(oauth, /all\.filter\(cal => enabledIds\.has\(cal\.id\)\)/);
  // Por defecto solo el principal queda habilitado; los demás calendarios nuevos entran apagados.
  assert.match(oauth, /cal\.primary \? 1 : 0, cal\.primary \? 1 : 0/);
});
test("los eventos de calendarios no elegidos se retiran de la agenda", () => {
  assert.match(oauth, /AND calendar_id NOT IN \(/);
});
test("la API y la pantalla permiten elegir calendarios", () => {
  assert.match(route, /action === "setCalendar"/);
  assert.match(ui, /data-testid="calendar-choices"/);
  assert.match(ui, /action: "setCalendar"/);
});

test("la app deja explícito el papel de cada correo", () => {
  const digest = readFileSync(new URL("../components/agenda-digest-settings.tsx", import.meta.url), "utf8");
  const mail = readFileSync(new URL("../components/appointment-mail-settings.tsx", import.meta.url), "utf8");
  assert.match(ui, /data-testid="audience-agenda"/);
  assert.match(ui, /el calendario de la técnico no se agrega aquí/);
  assert.match(digest, /su propio calendario nunca se agrega al de la clínica/);
  assert.match(mail, /distinto al correo con que entras a la app/);
});
