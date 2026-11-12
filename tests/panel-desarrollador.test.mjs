import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildDentistRows, dashboardSummary, dentistsCsv, developerEmails, isDeveloperEmail } from "../lib/developer-dashboard.ts";

test("solo el correo del desarrollador abre el panel", () => {
  assert.equal(isDeveloperEmail("remdental09@gmail.com"), true);
  assert.equal(isDeveloperEmail("  RemDental09@Gmail.com "), true);
  assert.equal(isDeveloperEmail("otro.dentista@gmail.com"), false);
  assert.equal(isDeveloperEmail(""), false);
  assert.equal(isDeveloperEmail(null), false);
  assert.equal(isDeveloperEmail("a@b.cl", "a@b.cl, c@d.cl"), true);
  assert.equal(isDeveloperEmail("remdental09@gmail.com", "a@b.cl"), false, "si se configura otra lista, reemplaza a la de fábrica");
  assert.deepEqual([...developerEmails("")], ["remdental09@gmail.com"]);
});

const users = [
  { owner_id: "o-1", email: "uno@gmail.com", google_name: "Ana Uno", first_seen: "2026-11-10T12:00:00.000Z", last_seen: "2026-11-12T15:00:00.000Z", visits: 4 },
  { owner_id: "o-2", email: "dos@gmail.com", google_name: "Beto Dos", first_seen: "2026-11-12T16:00:00.000Z", last_seen: "2026-11-12T16:00:00.000Z", visits: 1 },
];
const profiles = [
  { owner_id: "o-1", email: "uno@gmail.com", first_name: "Ana", last_name: "Uno", rut: "11.111.111-1", specialty: "Endodoncia", clinic_name: "Clínica A", extra_titles: "", created_at: "2026-11-10T12:05:00.000Z" },
  { owner_id: "o-3", email: "tres@gmail.com", first_name: "Carla", last_name: "Tres", rut: "22.222.222-2", specialty: "Implantología", clinic_name: null, extra_titles: null, created_at: "2026-01-02T10:00:00.000Z" },
];

test("junta ingresos y registros: registrados, sin completar y registros antiguos sin ingreso anotado", () => {
  const rows = buildDentistRows(users, profiles, [{ owner_id: "o-1", patients: 7 }], [{ owner_id: "o-1", notes: 12, last_note: "2026-11-12T14:00:00.000Z" }]);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(r => r.email), ["dos@gmail.com", "uno@gmail.com", "tres@gmail.com"], "más reciente primero");
  const [dos, uno, tres] = rows;
  assert.equal(dos.registered, false);
  assert.equal(dos.name, "");
  assert.equal(dos.googleName, "Beto Dos");
  assert.equal(uno.name, "Dr(a). Ana Uno");
  assert.equal(uno.patients, 7);
  assert.equal(uno.notes, 12);
  assert.equal(uno.visits, 4);
  assert.equal(uno.firstSeen, "2026-11-10T12:00:00.000Z");
  assert.equal(tres.registered, true);
  assert.equal(tres.lastSeen, null);
  assert.equal(tres.firstSeen, "2026-01-02T10:00:00.000Z", "sin ingreso anotado, el primer ingreso es la fecha de registro");
  assert.equal(tres.clinic, "");
  assert.ok(rows.every(r => !("owner_id" in r) && !JSON.stringify(r).includes("o-1")), "el panel no expone owner_id");
});

test("resumen del panel", () => {
  const rows = buildDentistRows(users, profiles, [{ owner_id: "o-1", patients: 7 }, { owner_id: "o-3", patients: 2 }], []);
  assert.deepEqual(dashboardSummary(rows, new Date("2026-11-12T20:00:00.000Z")), { total: 3, registered: 2, pending: 1, activeLast7Days: 2, newLast30Days: 2, patients: 9 });
});

test("CSV para Excel: separador punto y coma, BOM y comillas", () => {
  const rows = buildDentistRows(users, [{ ...profiles[0], clinic_name: 'Clínica "Sur"; Centro' }], [], []);
  const csv = dentistsCsv(rows);
  assert.ok(csv.startsWith("﻿Nombre;Correo;"));
  assert.ok(csv.includes('"Clínica ""Sur""; Centro"'));
  assert.equal(csv.split("\n").length, 3);
});

test("la API y el botón quedan cerrados a quien no es desarrollador", () => {
  const route = readFileSync(new URL("../app/api/desarrollador/route.ts", import.meta.url), "utf8");
  assert.match(route, /isDeveloperEmail\(user\.email/);
  assert.match(route, /403/);
  const clinical = readFileSync(new URL("../app/api/clinical/route.ts", import.meta.url), "utf8");
  assert.match(clinical, /touchAppUser\([^)]*\)\.catch\(/, "anotar el ingreso nunca debe romper la carga de fichas");
  assert.match(clinical, /developer: isDeveloperEmail\(/);
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /\{isDeveloper&&<a href="\/desarrollador"/);
  const wrangler = readFileSync(new URL("../wrangler.cloudflare.jsonc", import.meta.url), "utf8");
  assert.match(wrangler, /"DEVELOPER_EMAILS": "remdental09@gmail.com"/);
});
