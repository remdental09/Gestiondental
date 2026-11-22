// Genera public/datos/medicamentos-isp.json (formato compacto) desde el CSV del catálogo ISP.
// Uso: node scripts/build-medication-catalog.mjs ruta/medicamentos-isp.csv
// Fuente: buscador público de productos registrados del ISP (https://registrosanitario.ispch.gob.cl/).
import { readFileSync, writeFileSync } from "node:fs";

const input = process.argv[2];
if (!input) { console.error("Uso: node scripts/build-medication-catalog.mjs medicamentos-isp.csv"); process.exit(1); }

function parseCsv(text) {
  const rows = []; let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c; }
    else if (c === '"') quoted = true;
    else if (c === ";") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const [header, ...data] = parseCsv(readFileSync(input, "utf8").replace(/^﻿/, ""));
const col = Object.fromEntries(header.map((name, i) => [name, i]));
for (const name of ["isp_registration", "product_name", "active_ingredient", "legal_control", "medicine_type", "source_exported_at"]) if (!(name in col)) throw new Error(`Falta la columna ${name}`);
const CONTROL = { "": 0, "Psicotrópico": 1, "Estupefaciente": 2 };
const rows = data.filter(r => r[col.isp_registration]).map(r => {
  const control = CONTROL[r[col.legal_control]];
  if (control === undefined) throw new Error(`Control legal desconocido: ${r[col.legal_control]}`);
  return [r[col.isp_registration], r[col.product_name].trim(), r[col.active_ingredient].trim(), control, r[col.medicine_type]];
});
const out = { version: 1, fuente: "ISP Chile, buscador de productos registrados", exportado: data[0][col.source_exported_at].slice(0, 10), campos: ["registro", "nombre", "principioActivo", "control", "tipo"], control: ["", "Psicotrópico", "Estupefaciente"], filas: rows };
writeFileSync(new URL("../public/datos/medicamentos-isp.json", import.meta.url), JSON.stringify(out));
console.log(`${rows.length} productos`);
