import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBudgetPdf, pdfSafe, itemZoneText, issuedParts } from '../lib/budget-pdf.ts';
import { PDFDocument } from 'pdf-lib';
import { buildRawMessage, budgetEmail } from '../lib/appointment-mail.ts';

const decode = raw => Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
const pageCount = async bytes => (await PDFDocument.load(bytes)).getPageCount();

const sample = (n = 3) => Array.from({ length: n }, (_, i) => ({ label: `Obturación ${i}`, amount: 30000, phase: 'Fase 1', teeth: [11 + (i % 8)] }));
const base = { patientName: 'Ñandú Pérez', professionalName: 'Dr(a). Prueba', clinicName: 'Clínica', };

test('el PDF es válido en los tres formatos y no queda en blanco', async () => {
  for (const mode of ['detailed', 'total', 'no-prices']) {
    const bytes = await buildBudgetPdf({ ...base, mode, budget: { title: 'Plan − “prueba” ✓', date: '16 nov 2026', items: sample() } });
    assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), '%PDF-');
    assert.equal(await pageCount(bytes), 1, mode);
    assert.ok(bytes.length > 1200, mode);
  }
});

test('un plan largo se reparte en varias páginas sin cortarse', async () => {
  const bytes = await buildBudgetPdf({ ...base, budget: { title: 'Largo', date: '16 nov 2026', items: sample(30) } });
  assert.ok(await pageCount(bytes) >= 2);
});

test('caracteres fuera de Latin-1 no rompen el PDF', async () => {
  assert.equal(pdfSafe('a−b ✓ ñ á'), 'a-b ? ñ á');
  await assert.doesNotReject(buildBudgetPdf({ ...base, patientName: 'Zoë 😀 Núñez', budget: { title: '😀', date: 'x', items: [{ label: 'Prueba ✓ 😀', amount: 1000 }] } }));
});

test('la zona del plan se muestra como zona o como piezas en FDI y chilena', () => {
  assert.equal(itemZoneText({ label: 'x', amount: 1, zone: 'perm:boca' }), 'Boca completa');
  assert.equal(itemZoneText({ label: 'x', amount: 1, teeth: [36, 46] }), 'Piezas 3.6, 4.6 · Chile 30, 19');
  assert.equal(itemZoneText({ label: 'x', amount: 1 }), '—');
});

test('el correo con PDF lleva adjunto y conserva texto y HTML', () => {
  const raw = buildRawMessage({ from: 'a@b.cl', to: 'p@q.cl', subject: 'Plan', text: 'hola', html: '<p>hola</p>', attachments: [{ filename: 'Presupuesto-de-tratamiento-1.pdf', contentType: 'application/pdf', base64: Buffer.from('%PDF-demo').toString('base64') }] });
  const mime = decode(raw);
  assert.match(mime, /Content-Type: multipart\/mixed/);
  assert.match(mime, /Content-Type: multipart\/alternative/);
  assert.match(mime, /Content-Type: application\/pdf/);
  assert.match(mime, /Content-Disposition: attachment/);
  assert.match(mime, /text\/html/);
});

test('sin adjuntos el correo sigue siendo multipart/alternative', () => {
  const mime = decode(buildRawMessage({ from: 'a@b.cl', to: 'p@q.cl', subject: 'x', text: 't', html: '<p>t</p>' }));
  assert.doesNotMatch(mime, /multipart\/mixed/);
  assert.match(mime, /multipart\/alternative/);
});

test('el texto del correo del presupuesto no lleva datos clínicos ni valores', () => {
  const mail = budgetEmail({ patientName: 'María Soto', clinicName: 'Clínica', professionalName: 'Dr(a). Prueba', title: 'Implante pieza 3' });
  assert.match(mail.subject, /plan de tratamiento/);
  assert.doesNotMatch(mail.text + mail.html, /implante|\$/i);
  assert.match(mail.text, /Estimado\(a\) María/);
});

test('la hora de emisión sale en hora de Chile (verano y invierno)', () => {
  assert.deepEqual(issuedParts(new Date('2026-11-16T17:07:00Z')), { day: '16/11/2026', time: '14:07' });
  assert.deepEqual(issuedParts(new Date('2026-07-01T17:07:00Z')), { day: '01/07/2026', time: '13:07' });
  assert.deepEqual(issuedParts(new Date('2026-11-16T03:05:00Z')), { day: '16/11/2026', time: '00:05' });
});

test('el PDF profesional con todos los datos y varias fases se genera en los tres formatos', async () => {
  const items = Array.from({ length: 3 }, (_, i) => ({ label: `Tratamiento ${i}`, amount: 50000, phase: i < 2 ? 'Fase 1' : 'Fase 2', ...(i === 0 ? { zone: 'perm:boca' } : { teeth: [11 + i] }), discountPercent: i === 1 ? 10 : 0 }));
  for (const mode of ['detailed', 'total', 'no-prices']) {
    const bytes = await buildBudgetPdf({ ...base, mode, issuedAt: new Date('2026-11-16T17:07:00Z'), patientDocument: '12.345.678-9', professionalSpecialty: 'Implantología', professionalDocument: '11.222.333-4', contactEmail: 'a@b.cl', budget: { id: 783, title: 'Plan 1', date: '16 nov 2026', items } });
    assert.equal(await pageCount(bytes), 1, mode);
    assert.equal((await PDFDocument.load(bytes)).getTitle(), 'Presupuesto de tratamiento N° 783');
  }
});
