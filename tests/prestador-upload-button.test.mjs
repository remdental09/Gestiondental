import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const card = read("components/prestador-card.tsx");
const constant = name => { const match = card.match(new RegExp(`export const ${name} = "([^"]+)"`)); assert.ok(match, `falta ${name}`); return match[1].split(/\s+/); };

// Utilidades de Tailwind que fijan la misma propiedad: si se mezclan, gana la que aparece después en el CSS compilado,
// no la que va al final del atributo class. Así quedó «Subir certificado (PDF)» blanco sobre blanco (PR #352).
const groups = {
  fondo: c => /^bg-(white|transparent|black|\[#|[a-z]+-\d)/.test(c),
  texto: c => /^text-(white|black|\[#|[a-z]+-\d)/.test(c),
  borde: c => /^border-(transparent|white|\[#|[a-z]+-\d)/.test(c),
};

test("botón Subir certificado: ninguna clase de color en conflicto (fondo, texto, borde)", () => {
  for (const name of ["primaryButton", "secondaryButton"]) {
    const classes = constant(name);
    for (const [group, matches] of Object.entries(groups)) assert.ok(classes.filter(matches).length <= 1, `${name}: más de una clase de ${group}: ${classes.filter(matches).join(" ")}`);
  }
  const primary = constant("primaryButton");
  assert.ok(primary.includes("bg-[#473a6d]") && primary.includes("text-white"), "el principal es morado con texto blanco");
  assert.ok(!primary.includes("bg-white") && !primary.includes("border-transparent"));
});

test("botón Subir certificado: se elige una u otra constante, sin sobreescribir colores encima", () => {
  const control = card.slice(card.indexOf('data-testid="prestador-upload"') - 400, card.indexOf('data-testid="prestador-upload"'));
  assert.match(control, /registration\?\.certificate \? secondaryButton : primaryButton/);
  assert.doesNotMatch(control, /border-transparent|bg-white|text-white|bg-\[#/, "sin clases de color agregadas al vuelo");
  assert.doesNotMatch(card, /\$\{button\} \$\{/, "no se concatenan colores sobre el estilo base");
});

test("botón Subir certificado: es un <label> con el input de PDF adentro (Safari iPhone abre Archivos)", () => {
  const start = card.indexOf("<label", card.indexOf('{!loading && <div className="mt-3 flex flex-wrap gap-2">'));
  const end = card.indexOf("</label>", start);
  const label = card.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.match(label, /data-testid="prestador-upload"/);
  assert.match(label, /<input ref=\{input\} type="file" accept="application\/pdf,\.pdf" className="sr-only"/);
  assert.match(label, /Subir certificado \(PDF\)/);
  assert.doesNotMatch(card, /hidden[^"]*" accept="application\/pdf/, "el input no usa display:none (iOS no lo abriría)");
});

test("QR del certificado: respaldo leyendo la imagen incrustada del PDF (el RNPI trae el QR como JPEG aparte)", () => {
  const qr = read("components/certificate-qr.ts");
  assert.match(qr, /async function qrFromEmbeddedImages/);
  assert.match(qr, /OPS\.paintImageXObject/);
  assert.match(qr, /return await qrFromEmbeddedImages\(pdf\)/);
});
