import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import {
  autoMap, buildApptRows, buildNoteRows, buildPatientRows, decodeText, detectDelimiter, detectSheetKind, findHeaderRow, guessField,
  normalizeGender, normalizeInsurance, normalizePhone, normalizeRut, parseDateAny, parseDelimited, parseTimeAny, rejectedCsv, stableKey,
} from "../lib/patient-import.ts";

const today = new Date("2026-11-21T12:00:00Z");

// Archivos sintéticos (datos inventados; nunca datos reales de pacientes), generados en memoria.
const dv = body => { let s = 0, f = 2; for (const d of String(body).split("").reverse()) { s += +d * f; f = f === 7 ? 2 : f + 1; } const e = 11 - (s % 11); return e === 11 ? "0" : e === 10 ? "K" : String(e); };
const bodies = [11111111, 12345678, 15222333, 9876543, 20111222, 7654321];
const pac = [
  ["SISTEMA DENTAL — Listado de pacientes", "", "", ""],
  ["N° Ficha", "RUT", "DV", "Nombres", "Apellido Paterno", "Apellido Materno", "Fecha Nac.", "Sexo", "Teléfono", "Celular", "E-mail", "Dirección", "Comuna", "Previsión", "Observaciones", "Alergias"],
  [101, bodies[0], dv(bodies[0]), "Prueba Uno", "Sintético", "Ejemplo", 31048, "F", "", 912345678, "uno@example.com", "Calle Falsa 123", "Ñuñoa", "FONASA B", "Hipertensa controlada", "Penicilina"],
  [102, bodies[1], dv(bodies[1]), "Prueba Dos", "Ficticio", "Demo", "05-03-1990", "M", "22 345 6789", "", "dos@example", "Av. Ejemplo 45", "Providencia", "Isapre Colmena", "", ""],
  [103, bodies[2], "0", "Error", "Rut", "Malo", "1/2/80", "F", "", "", "", "", "", "", "", ""],
  [104, bodies[3], dv(bodies[3]), "Prueba Cuatro", "Inventado", "Muestra", "31/02/2001", "", "", "+56 9 8765 4321", "cuatro@example.com", "", "", "Particular", "", ""],
  [105, bodies[1], dv(bodies[1]), "Prueba Dos Repetida", "Ficticio", "Demo", "", "", "", "", "", "", "", "", "", ""],
  [106, "", "", "Sin", "Rut", "Ejemplo", "", "", "", "", "", "", "", "", "", ""],
];
const evo = [["RUT Paciente", "Paciente", "Fecha", "Evolución", "Profesional"],
  [`${bodies[0]}-${dv(bodies[0])}`, "Prueba Uno Sintético", "12/05/2023", "Destartraje supragingival. Control en 6 meses.", "Dr. Demo"],
  [`${bodies[3]}-${dv(bodies[3])}`, "Prueba Cuatro", 45000, "Obturación resina pieza 3.6", "Dra. Demo"],
  ["1-9", "Nadie", "01/01/2024", "Sin ficha", ""]];
const citas = [["Rut", "Nombre", "Fecha", "Hora", "Motivo"],
  [`${bodies[0]}-${dv(bodies[0])}`, "Prueba Uno", "15-12-2026", "10:30", "Control"],
  [`${bodies[1]}-${dv(bodies[1])}`, "Prueba Dos", "16-12-2026", 0.6875, "Limpieza"]];
const pres = [["Rut", "Paciente", "N° Presupuesto", "Prestación", "Total", "Saldo"], [`${bodies[0]}-${dv(bodies[0])}`, "Prueba Uno", 1, "Exodoncia", 45000, 45000]];
function syntheticBook(bookType) {
  const wb = XLSX.utils.book_new();
  for (const [n, d] of [["Pacientes", pac], ["Evoluciones", evo], ["Citas", citas], ["Presupuestos", pres]]) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(d), n);
  return XLSX.write(wb, { type: "buffer", bookType });
}
const syntheticCsvLatin1 = () => Buffer.from(["RUN;Nombre completo;Fecha de nacimiento;Celular;Correo", `${bodies[4]}-${dv(bodies[4])};Josefa Peña Ñandú Sintética;12/10/1975;987654321;jose@example.com`, `${bodies[5]}-${dv(bodies[5])};Martín Gómez Prueba Ejemplo;1980-07-01;;`].join("\r\n"), "latin1");

test("encabezados en español (Dentalsoft u otros) se reconocen con tildes, N°, abreviaturas", () => {
  const header = ["N° Ficha", "RUT", "DV", "Nombres", "Apellido Paterno", "Apellido Materno", "Fecha Nac.", "Sexo", "Teléfono", "Celular", "E-mail", "Dirección", "Comuna", "Previsión", "Observaciones", "Alergias"];
  assert.deepEqual(autoMap(header), ["ficha", "rut", "dv", "nombres", "apellidoPaterno", "apellidoMaterno", "fechaNacimiento", "sexo", "telefono", "celular", "email", "direccion", "comuna", "prevision", "observaciones", "alertas"]);
  assert.deepEqual(autoMap(["Paciente", "Rut Paciente", "Fecha", "Evolución", "Profesional"]), ["nombreCompleto", "rut", "fechaAtencion", "evolucion", "profesional"]);
  assert.deepEqual(autoMap(["Rut", "Nombre", "Fecha", "Hora", "Motivo", "Estado"]), ["rut", "nombreCompleto", "fechaCita", "horaCita", "motivoCita", ""]);
  assert.deepEqual(autoMap(["RUN", "Nombre completo", "F. de nacimiento", "Fono celular", "Correo electrónico", "ISAPRE"]), ["rut", "nombreCompleto", "fechaNacimiento", "celular", "email", "prevision"]);
  assert.equal(guessField("Columna rara").field, null);
  assert.deepEqual(autoMap(["RUT", "Nombre"], { nombre: "nombres" }), ["rut", "nombres"], "el mapeo recordado manda");
  assert.equal(detectSheetKind(["Rut", "Paciente", "N° Presupuesto", "Total", "Saldo"], autoMap(["Rut", "Paciente", "N° Presupuesto", "Total", "Saldo"])), "presupuestos");
  assert.equal(detectSheetKind(["Rut", "Paciente", "Fecha pago", "Medio de pago", "Monto"], autoMap(["Rut", "Paciente", "Fecha pago", "Medio de pago", "Monto"])), "pagos");
  assert.equal(findHeaderRow([["LISTADO DE PACIENTES", ""], ["RUT", "Nombre", "Celular"], ["1-9", "A", "9"]]), 1);
});

test("RUT: formatos, dígito verificador y DV en otra columna", () => {
  assert.deepEqual(normalizeRut("12.345.678-5"), { value: "123456785", valid: true, empty: false });
  assert.equal(normalizeRut("12345678-k").valid, false);
  assert.equal(normalizeRut(12345678, "5").value, "123456785");
  assert.equal(normalizeRut("12345678", "5").valid, true);
  assert.equal(normalizeRut("7.654.321-6").valid, true);
  assert.equal(normalizeRut("").empty, true);
});

test("fechas: dd-mm-aaaa, dd/mm/aaaa, año de 2 dígitos, ISO, serie de Excel; inválidas → null", () => {
  assert.equal(parseDateAny("05-03-1990", today), "1990-03-05");
  assert.equal(parseDateAny("5/3/1990", today), "1990-03-05");
  assert.equal(parseDateAny("05.03.1990", today), "1990-03-05");
  assert.equal(parseDateAny("1/2/80", today), "1980-02-01");
  assert.equal(parseDateAny("1/2/20", today), "2020-02-01");
  assert.equal(parseDateAny("1990-03-05", today), "1990-03-05");
  assert.equal(parseDateAny(31048, today), "1985-01-01");
  assert.equal(parseDateAny(45000.5, today), "2023-03-15");
  assert.equal(parseDateAny("31/02/2001", today), null);
  assert.equal(parseDateAny("sin fecha", today), null);
  assert.equal(parseTimeAny("10:30"), "10:30");
  assert.equal(parseTimeAny(0.6875), "16:30");
  assert.equal(parseTimeAny("4:15 pm"), "16:15");
});

test("CSV: separador «;», «,» o tabulador; UTF-8 o Latin-1; comillas", () => {
  assert.equal(detectDelimiter("a;b;c\n1;2;3\n"), ";");
  assert.equal(detectDelimiter("a,b,c\n\"1,5\",2,3\n"), ",");
  assert.equal(detectDelimiter("a\tb\n1\t2\n"), "\t");
  assert.equal(detectDelimiter("nombre;observación\n\"Pérez, Ana\";control, 6 meses\n"), ";");
  assert.deepEqual(parseDelimited('rut;nota\n1-9;"dice ""hola""; y\nsigue"\n'), [["rut", "nota"], ["1-9", 'dice "hola"; y\nsigue']]);
  const latin1 = new Uint8Array([0x4e, 0xfa, 0xf1, 0x6f, 0x61]); // «Núñoa» en Windows-1252
  assert.deepEqual(decodeText(latin1), { text: "Núñoa", encoding: "latin-1" });
  assert.deepEqual(decodeText(new TextEncoder().encode("\uFEFFÑuñoa")), { text: "Ñuñoa", encoding: "utf-8" });
});

test("valores: teléfono, sexo, previsión", () => {
  assert.equal(normalizePhone(912345678), "+56 9 1234 5678");
  assert.equal(normalizePhone("+56912345678"), "+56 9 1234 5678");
  assert.equal(normalizePhone("22 345 6789"), "+56 223456789");
  assert.equal(normalizePhone("123"), "");
  assert.equal(normalizeGender("F"), "Femenino");
  assert.equal(normalizeGender("masculino"), "Masculino");
  assert.deepEqual(normalizeInsurance("FONASA B"), { insurance: "Fonasa", insurer: "" });
  assert.deepEqual(normalizeInsurance("Isapre Banmédica"), { insurance: "Banmédica", insurer: "" });
  assert.deepEqual(normalizeInsurance("Seguro X"), { insurance: "Otra", insurer: "Seguro X" });
});

test("Excel sintético (.xlsx y .xls): pacientes validados, duplicados, existentes, evoluciones y citas por RUT", () => {
  for (const file of ["xlsx", "biff8"]) {
    const book = XLSX.read(syntheticBook(file), { type: "buffer" });
    const sheet = name => XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, raw: true, defval: "", blankrows: false });
    const pac = sheet("Pacientes"), h = findHeaderRow(pac), mapping = autoMap(pac[h]);
    assert.equal(detectSheetKind(pac[h], mapping), "pacientes", file);
    const rows = buildPatientRows(pac.slice(h + 1), mapping, new Set(["98765433"]), h + 2, today);
    assert.deepEqual(rows.map(r => r.status), ["nuevo", "nuevo", "error", "existe", "duplicado", "nuevo"], file);
    assert.equal(rows[0].data.name, "Prueba Uno Sintético Ejemplo");
    assert.equal(rows[0].data.birthDate, "1985-01-01");
    assert.equal(rows[0].data.phone, "+56 9 1234 5678");
    assert.equal(rows[0].data.insurance, "Fonasa");
    assert.equal(rows[0].data.gender, "Femenino");
    assert.match(rows[0].data.history, /Hipertensa controlada\nN° de ficha en el sistema anterior: 101/);
    assert.equal(rows[0].data.allergies, "Penicilina");
    assert.equal(rows[1].data.email, "", "correo inválido se descarta con aviso");
    assert.ok(rows[1].warnings.some(w => /Correo/.test(w)));
    assert.match(rows[2].errors[0], /RUT inválido/);
    assert.ok(rows[3].warnings.some(w => /no reconocida/.test(w)), "31/02 no es fecha");
    assert.equal(rows[4].duplicateOf, 4);
    assert.ok(rows[5].warnings.some(w => /Sin RUT/.test(w)));
    const known = new Set(rows.filter(r => r.data.rut && r.status !== "error").map(r => r.data.rut));
    const evo = sheet("Evoluciones"), em = autoMap(evo[0]);
    assert.equal(detectSheetKind(evo[0], em), "evoluciones");
    const notes = buildNoteRows(evo.slice(1), em, known, 2, today);
    assert.deepEqual(notes.map(n => n.errors.length), [0, 0, 1]);
    assert.equal(notes[1].date, "2023-03-15");
    assert.equal(notes[0].requestId, buildNoteRows(evo.slice(1), em, known, 2, today)[0].requestId, "id estable");
    const citas = sheet("Citas"), cm = autoMap(citas[0]);
    assert.equal(detectSheetKind(citas[0], cm), "citas");
    assert.deepEqual(buildApptRows(citas.slice(1), cm, known, 2, today).map(a => [a.day, a.time, a.errors.length]), [["2026-12-15", "10:30", 0], ["2026-12-16", "16:30", 0]]);
    const pres = sheet("Presupuestos");
    assert.equal(detectSheetKind(pres[0], autoMap(pres[0])), "presupuestos");
  }
});

test("CSV Latin-1 con «;» de un sistema distinto", () => {
  const { text, encoding } = decodeText(new Uint8Array(syntheticCsvLatin1()));
  assert.equal(encoding, "latin-1");
  const rows = parseDelimited(text);
  const rowsOut = buildPatientRows(rows.slice(1), autoMap(rows[0]), new Set(), 2, today);
  assert.equal(rowsOut[0].data.name, "Josefa Peña Ñandú Sintética");
  assert.equal(rowsOut[0].data.birthDate, "1975-10-12");
  assert.equal(rowsOut[1].data.birthDate, "1980-07-01");
  assert.deepEqual(rowsOut.map(r => r.status), ["nuevo", "nuevo"]);
});

test("CSV de rechazadas y clave estable", () => {
  const csv = rejectedCsv([{ file: "a.xlsx", sheet: "Pacientes", line: 5, reason: "RUT inválido", cells: [["Nombre", "Ana; \"X\""], ["RUT", "1-0"]] }]);
  assert.ok(csv.startsWith("\uFEFFArchivo;Hoja;Fila;Motivo del rechazo;Nombre;RUT\r\n"));
  assert.match(csv, /a\.xlsx;Pacientes;5;RUT inválido;"Ana; ""X""";1-0/);
  assert.equal(stableKey("abc"), stableKey("abc"));
  assert.notEqual(stableKey("abc"), stableKey("abd"));
  assert.match(stableKey("x"), /^[0-9a-z]{1,14}$/);
});

test("servidor: todo filtrado por owner_id y la ruta exige administrador", () => {
  const db = readFileSync(new URL("../app/patient-import-db.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../app/api/importar-pacientes/route.ts", import.meta.url), "utf8");
  for (const query of db.match(/\.from\((patients|evolutions|appointments)\)\.where\([^;]+/g)) assert.match(query, /eq\(\w+\.ownerId, ownerId\)/, query);
  assert.match(db, /\.where\(and\(eq\(patients\.id, found\.id\), eq\(patients\.ownerId, ownerId\)\)\)/);
  assert.match(route, /canManageTeam\(spaceRoleOf\(viewer\)\)/);
  assert.match(db, /CREATE TABLE IF NOT EXISTS import_header_mappings/);
});
